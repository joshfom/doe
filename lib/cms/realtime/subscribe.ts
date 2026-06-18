import { Client } from "pg";
import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type Database } from "../db";
import { events } from "../schema";
import { DOE_EVENTS_CHANNEL, type DoeEvent, type DoeEventType } from "./events";

// ── SSE subscriber: LISTEN/NOTIFY fan-out (Design §15, §3 transport b) ────────
// `publishEvent` (events.ts) writes one append-only `events` row and issues
// `pg_notify('doe_events', <event id>)` carrying only the id. Here we hold ONE
// shared `pg` LISTEN connection per process. On each NOTIFY we re-read the full
// row by id and fan it out to every locally-connected subscriber's
// `ReadableStream` controller. One DB listener regardless of subscriber count.
//
// Each subscriber stream:
//   1. Replays the recent `events` backlog so a late Console isn't blank.
//   2. Delivers live events with NO gap across the replay→live boundary
//      (Property 12): the controller is registered with the live fan-out
//      BEFORE replay runs, live events arriving during replay are buffered, and
//      the buffer is flushed (deduped by id) once replay completes.
//   3. Emits an SSE heartbeat comment at least every 15s so Caddy keeps the
//      long-lived connection open (Requirement 7.5).
//
// Output is SSE wire format encoded to bytes: `data: ${JSON.stringify(event)}\n\n`.

/** Default number of recent events replayed to a freshly-connected subscriber. */
const DEFAULT_REPLAY_LIMIT = 100;

/** Heartbeat interval — must stay well under Caddy/proxy idle timeouts. */
const HEARTBEAT_MS = 15_000;

/** A live-event sink registered by an active subscriber stream. */
export type EventListener = (event: DoeEvent) => void;

/** Process-local fan-out registry of active subscriber sinks. */
const liveListeners = new Set<EventListener>();

/**
 * Register a process-local listener onto the live event fan-out and return an
 * unsubscribe function. Unlike {@link createEventStream} (which builds a
 * per-connection SSE byte stream for the Demo Console), this is the seam for an
 * IN-PROCESS consumer that reacts to events without holding an HTTP stream open
 * — e.g. the Home_Surface's Briefing_Cache invalidation listener
 * (`lib/cms/api/routes/home.ts`), which maps a Tool_Dispatcher mutation event
 * onto `invalidateBriefingCache` (Req 5.5).
 *
 * The listener receives every event the shared LISTEN connection fans out (the
 * same delivery path the SSE streams use, via {@link handleNotification}). It
 * opens the shared LISTEN connection on the default channel so live NOTIFYs
 * reach it on the Bun mount; on a mount without LISTEN/NOTIFY support the
 * listener still receives events driven directly through
 * {@link handleNotification}.
 *
 * @param listener the sink invoked for each delivered {@link DoeEvent}.
 * @param channel  the LISTEN channel to ensure is open (defaults to the DOE bus).
 * @returns an idempotent unsubscribe function that removes the listener.
 */
export function subscribeToEvents(
  listener: EventListener,
  channel: string = DOE_EVENTS_CHANNEL
): () => void {
  liveListeners.add(listener);

  // Best-effort: open the shared LISTEN connection so live NOTIFYs are fanned
  // out to this listener on the Bun mount. A failure is non-fatal — the
  // listener is still registered and can be driven via handleNotification.
  void ensureListener(channel).catch((err) => {
    console.error("[realtime] subscribeToEvents could not open LISTEN:", err);
  });

  return () => {
    liveListeners.delete(listener);
  };
}

// ── Shared LISTEN connection (one per process) ────────────────────────────────
let listenClient: Client | null = null;
let listenReady: Promise<void> | null = null;
const listenedChannels = new Set<string>();

/** Postgres identifier guard for channel names used in unparameterizable LISTEN. */
function assertSafeChannel(channel: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(channel)) {
    throw new Error(`Unsafe LISTEN channel name: ${channel}`);
  }
}

/**
 * Ensure the single shared LISTEN connection exists and is subscribed to
 * `channel`. Subsequent subscribers reuse the same connection. On connection
 * error the singleton is reset so a future subscriber transparently reconnects.
 */
async function ensureListener(channel: string): Promise<void> {
  if (!listenReady) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    listenClient = client;
    listenReady = client
      .connect()
      .then(() => {
        client.on("notification", (msg) => {
          if (!msg.payload) return;
          // Re-read the row by id and fan out; errors must not crash the process.
          void handleNotification(msg.payload).catch((err) => {
            console.error("[realtime] fan-out failed:", err);
          });
        });
        client.on("error", (err) => {
          console.error("[realtime] LISTEN connection error:", err);
          listenClient = null;
          listenReady = null;
          listenedChannels.clear();
        });
      })
      .catch((err) => {
        // Reset so the next subscriber retries from scratch.
        listenClient = null;
        listenReady = null;
        listenedChannels.clear();
        throw err;
      });
  }

  await listenReady;

  if (listenClient && !listenedChannels.has(channel)) {
    assertSafeChannel(channel);
    await listenClient.query(`LISTEN ${channel}`);
    listenedChannels.add(channel);
  }
}

/** Convert a persisted `events` row into the public `DoeEvent` shape. */
function toDoeEvent(row: {
  id: string;
  type: string;
  payload: unknown;
  at: Date | string;
}): DoeEvent {
  return {
    id: row.id,
    type: row.type as DoeEventType,
    payload: row.payload,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
  };
}

/** Load a single event row by id. */
async function loadEvent(
  id: string,
  database: Database = defaultDb
): Promise<DoeEvent | null> {
  const [row] = await database
    .select()
    .from(events)
    .where(eq(events.id, id))
    .limit(1);
  return row ? toDoeEvent(row) : null;
}

/**
 * Handle a NOTIFY payload (an event id): load the full row and deliver it to
 * every connected subscriber. Exported so the SSE route's live path and tests
 * can drive fan-out directly (NOTIFY is simulated in environments without
 * LISTEN/NOTIFY support).
 */
export async function handleNotification(
  eventId: string,
  database: Database = defaultDb
): Promise<void> {
  if (liveListeners.size === 0) return;
  const event = await loadEvent(eventId, database);
  if (!event) return;
  for (const listener of liveListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("[realtime] subscriber sink threw:", err);
    }
  }
}

/** Options for {@link createEventStream}; the extra fields aid testing. */
export interface EventStreamOptions {
  /** Database handle for replay reads (defaults to the shared `db`). */
  db?: Database;
  /** Number of recent events to replay on connect. */
  replayLimit?: number;
  /**
   * When false, skip opening the shared LISTEN connection. Live delivery then
   * relies on {@link handleNotification} being called directly (used in tests
   * where Postgres LISTEN/NOTIFY is unavailable).
   */
  listen?: boolean;
  /**
   * Optional predicate restricting which events this stream emits. When
   * provided, only events for which it returns `true` are replayed AND streamed
   * live; everything else is silently skipped. Used by scoped routes (e.g. the
   * leads dashboard stream) so a `leads:read` subscriber never receives voice
   * transcripts or other unrelated events.
   */
  filter?: (event: DoeEvent) => boolean;
}

/**
 * Build an SSE byte stream backing `GET /api/realtime/events`.
 *
 * Replays the recent `events` backlog, then streams live events with no gap
 * across the boundary, plus a ≥15s heartbeat comment. Returns the raw
 * `ReadableStream<Uint8Array>`; use {@link streamEvents} for a ready-made
 * `Response` with SSE headers.
 */
export function createEventStream(
  channel: string = DOE_EVENTS_CHANNEL,
  options: EventStreamOptions = {}
): ReadableStream<Uint8Array> {
  const database = options.db ?? defaultDb;
  const replayLimit = options.replayLimit ?? DEFAULT_REPLAY_LIMIT;
  const filter = options.filter;
  const encoder = new TextEncoder();

  let listener: EventListener | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const send = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: string) => {
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      // Controller already closed (subscriber disconnected); ignore.
    }
  };

  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: DoeEvent
  ) => {
    if (filter && !filter(event)) return;
    send(controller, `data: ${JSON.stringify(event)}\n\n`);
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Events delivered live while we are still replaying the backlog. Buffered
      // so nothing is dropped across the replay→live boundary (Property 12).
      const buffered: DoeEvent[] = [];
      const replayedIds = new Set<string>();
      let replayDone = false;

      listener = (event: DoeEvent) => {
        if (!replayDone) {
          buffered.push(event);
          return;
        }
        emit(controller, event);
      };

      // Register with the live fan-out BEFORE replay so concurrent events are
      // captured rather than lost in the window between replay and going live.
      liveListeners.add(listener);

      if (options.listen !== false) {
        try {
          await ensureListener(channel);
        } catch (err) {
          // Replay + (test-driven) live delivery still work without LISTEN.
          console.error("[realtime] could not open LISTEN connection:", err);
        }
      }

      // 1. Replay recent backlog, oldest→newest.
      try {
        const rows = await database
          .select()
          .from(events)
          .orderBy(desc(events.at), desc(events.id))
          .limit(replayLimit);

        for (const row of rows.reverse()) {
          const event = toDoeEvent(row);
          replayedIds.add(event.id);
          emit(controller, event);
        }
      } catch (err) {
        console.error("[realtime] replay query failed:", err);
      }

      // 2. Flush events buffered during replay, skipping any already replayed.
      //    Buffered (non-duplicate) events are necessarily newer than every
      //    replay row, so chronological order is preserved.
      replayDone = true;
      for (const event of buffered) {
        if (replayedIds.has(event.id)) continue;
        emit(controller, event);
      }
      buffered.length = 0;
      // Past the boundary new live ids are strictly newer; drop the dedup set.
      replayedIds.clear();

      // 3. Heartbeat so the proxy keeps the long-lived connection open.
      send(controller, ": connected\n\n");
      heartbeat = setInterval(() => {
        send(controller, ": heartbeat\n\n");
      }, HEARTBEAT_MS);
    },

    cancel() {
      if (listener) {
        liveListeners.delete(listener);
        listener = null;
      }
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });
}

/**
 * Wrap {@link createEventStream} in a `Response` with SSE headers. This is the
 * handler the realtime route (task 2.4) returns; it is only effective on the
 * Bun mount (`api.listen`) — the Next bridge cannot hold the stream open.
 *
 * An optional {@link EventStreamOptions.filter} restricts which events the
 * stream emits, so a scoped route (e.g. the `leads:read`-gated leads stream)
 * can deliver only its own event family.
 */
export function streamEvents(
  _request?: Request,
  channel: string = DOE_EVENTS_CHANNEL,
  options: Pick<EventStreamOptions, "filter"> = {}
): Response {
  return new Response(createEventStream(channel, options), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defensive: disable proxy buffering even if Caddy config is missed.
      "X-Accel-Buffering": "no",
    },
  });
}
