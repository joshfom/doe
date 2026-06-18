import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  redactHomeContent,
  redactPhones,
  redactPhonesInString,
  REDACTED_PHONE_MARKER,
} from "./redact";

/**
 * Feature: agentic-home, Property 8: No raw phone number (full or any digit substring including the last four) ever appears in Briefing content, an SSE_Event_Bus payload, or the Audit_Log.
 *
 * *For any* value the Home_Surface is about to present as Briefing content
 * (a Stack_Item that references a lead or person — Requirement 2.7), publish to
 * the SSE_Event_Bus (Requirement 13.4), or write to the Audit_Log
 * (Requirement 9.4), no raw phone number — COMPLETE or as any DIGIT SUBSTRING
 * including a last-four fragment — survives redaction.
 *
 * **Validates: Requirements 2.7, 9.4, 13.4**
 *
 * The implementation under test is the home surface's named redaction entry
 * point `redactHomeContent` (and the re-exported shared S1/S4 helpers
 * `redactPhones` / `redactPhonesInString`) in `lib/cms/agents/home/redact.ts`.
 * These tests treat it as a black box and verify the privacy guarantee with an
 * INDEPENDENT oracle: after redaction, the literal raw phone digit sequences we
 * injected — full numbers AND last-four / longer fragments — must not survive
 * anywhere in the emitted structure, once the legitimate redaction tokens
 * (`phone_hash:<hex>` and the `[redacted-phone]` marker) are removed.
 */

// ── Test salt (hermetic — never reads process.env) ───────────────────────────

const TEST_SALT = "doe-agentic-home-test-salt";
const MIN_FRAGMENT = 4; // last-four is the smallest redactable fragment (Req 2.7, 9.4)

// ── Oracle helpers (independent of the implementation) ───────────────────────

/** A redaction token the module is ALLOWED to leave behind. */
const PROTECTED_TOKEN = /phone_hash:[0-9a-f]+|\[redacted-phone\]/g;

/** Strip non-digit characters, yielding a bare digit sequence. */
function toDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Collect every string leaf in a JSON-like value (recursively). */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
  return out;
}

/**
 * Replace every legitimate redaction token with a space so the hex of a
 * `phone_hash:` value is never scanned and adjacent digits cannot merge across
 * a removed token. What remains is the "raw" residue the surface would emit
 * beyond its sanctioned tokens.
 */
function stripProtectedTokens(s: string): string {
  return s.replace(PROTECTED_TOKEN, " ");
}

/** Every digit run remaining in a string after protected tokens are removed. */
function residualDigitRuns(s: string): string[] {
  return stripProtectedTokens(s).match(/\d+/g) ?? [];
}

/**
 * True if `run` shares a contiguous digit window of length `minLen` with the
 * known phone digit sequence — i.e. `run` still carries a redactable fragment
 * of that phone (a last-four or longer). The privacy oracle: no surviving run
 * may carry any such window.
 */
function runCarriesPhoneWindow(
  run: string,
  phoneDigits: string,
  minLen: number,
): boolean {
  for (let i = 0; i + minLen <= run.length; i++) {
    if (phoneDigits.includes(run.slice(i, i + minLen))) return true;
  }
  return false;
}

/** Assert no injected phone digit sequence (full or fragment) survives. */
function assertNoRawPhoneSurvives(
  emitted: unknown,
  phoneDigitsList: readonly string[],
): void {
  const strings = collectStrings(emitted);
  for (const s of strings) {
    const runs = residualDigitRuns(s);
    for (const run of runs) {
      for (const phoneDigits of phoneDigitsList) {
        expect(
          runCarriesPhoneWindow(run, phoneDigits, MIN_FRAGMENT),
          `residual digit run "${run}" still carries a phone fragment of "${phoneDigits}" in emitted string "${s}"`,
        ).toBe(false);
      }
    }
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const BENIGN_WORDS = [
  "stack",
  "briefing",
  "follow-up",
  "appointment",
  "outstanding",
  "completed",
  "good morning",
  "this-week",
  "task",
  "lead",
  "ending in",
  "ref",
];

const benignWordArb = fc.constantFrom(...BENIGN_WORDS);

/** A bare E.164-ish phone: 8–15 digits, optionally prefixed with "+". */
const e164Arb = fc
  .tuple(
    fc.boolean(),
    fc
      .integer({ min: 8, max: 15 })
      .chain((len) =>
        fc.array(fc.integer({ min: 0, max: 9 }), {
          minLength: len,
          maxLength: len,
        }),
      ),
  )
  .map(([plus, ds]) => (plus ? "+" : "") + ds.join(""));

/** A lightly-formatted phone (spaces / dashes / parens) over the same digits. */
const formattedPhoneArb = e164Arb.chain((raw) => {
  const digits = toDigits(raw);
  return fc
    .array(fc.constantFrom(" ", "-", ".", ""), {
      minLength: digits.length - 1,
      maxLength: digits.length - 1,
    })
    .map((seps) => {
      let out = digits[0];
      for (let i = 1; i < digits.length; i++) out += seps[i - 1] + digits[i];
      return out;
    });
});

/** A phone bundle carrying every fragment we will inject and later forbid. */
interface PhoneBundle {
  /** The literal raw string placed into the structure (may carry "+"). */
  raw: string;
  /** Bare digit sequence used for the oracle window check + knownPhones. */
  digits: string;
  /** Last-four-digits fragment — the smallest fragment that must be redacted. */
  lastFour: string;
  /** A longer contiguous fragment (>= 4 digits) of the same phone. */
  fragment: string;
}

const phoneBundleArb: fc.Arbitrary<PhoneBundle> = e164Arb.chain((raw) => {
  const digits = toDigits(raw);
  const lastFour = digits.slice(-4);
  return fc
    .tuple(fc.integer({ min: 4, max: digits.length }), fc.nat())
    .map(([fragLen, startSeed]) => {
      const maxStart = digits.length - fragLen;
      const start = maxStart > 0 ? startSeed % (maxStart + 1) : 0;
      const fragment = digits.slice(start, start + fragLen);
      return { raw, digits, lastFour, fragment };
    });
});

// ── Property 8 ───────────────────────────────────────────────────────────────

// Feature: agentic-home, Property 8: No raw phone number (full or any digit substring including the last four) ever appears in Briefing content, an SSE_Event_Bus payload, or the Audit_Log.
describe("Feature: agentic-home, Property 8: No raw phone leakage from Briefing content, SSE payloads, or the Audit_Log", () => {
  // ── 8.a — complete numbers redacted with NO known phones in context ────────

  it("redacts complete phone numbers nested anywhere in Briefing / SSE / audit content (no phones in working context)", () => {
    fc.assert(
      fc.property(
        fc.array(e164Arb, { minLength: 1, maxLength: 4 }),
        fc.array(benignWordArb, { minLength: 0, maxLength: 6 }),
        (phones, words) => {
          // The realistic case: the home surface holds no raw phone (records
          // carry only the salted phone_hash — Req 9.4), so the complete-token
          // pass alone must catch standalone phone-shaped tokens embedded in a
          // Stack_Item title, an SSE payload, and an audit record.
          const sentence = (p: string) => `${words.join(" ")} call lead ${p} back`;
          const homeContent = {
            // Briefing content — a Stack_Item referencing a person (Req 2.7).
            briefing: {
              window: "morning",
              stack: phones.map((p, i) => ({
                id: `item-${i}`,
                kind: "lead_followup",
                title: sentence(p),
                status: "open",
              })),
              greeting: sentence(phones[0]),
            },
            // SSE_Event_Bus payload (Req 13.4).
            sse: {
              type: "stack.updated",
              payload: { note: phones.map((p) => `lead ${p}`).join("; ") },
            },
            // Audit_Log record (Req 9.4).
            audit: {
              action: "add_stack_item",
              detail: sentence(phones[phones.length - 1]),
            },
          };

          const emitted = redactHomeContent(homeContent, { salt: TEST_SALT });

          assertNoRawPhoneSurvives(emitted, phones.map(toDigits));

          // The sanctioned token convention is what replaced them.
          const flat = collectStrings(emitted).join(" ");
          expect(flat.includes("phone_hash:")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 8.b — fragments incl. last-four redacted when source phones in context ─

  it("redacts phone fragments including the last-four when the source phones are in working context", () => {
    fc.assert(
      fc.property(
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 4 }),
        (bundles) => {
          // Inject ONLY fragments (last-four and longer) — never the complete
          // number — into Briefing/SSE/audit free text. A bare 4-digit run is
          // indistinguishable from a metric figure to the complete-token pass,
          // so this exercises the knownPhones fragment pass (Req 2.7, 9.4).
          const homeContent = {
            briefing: {
              stack: bundles.map((b, i) => ({
                id: `item-${i}`,
                title: `the lead ending in ${b.lastFour} is stale`,
              })),
            },
            sse: {
              payload: { fragments: bundles.map((b) => `ref${b.fragment}x`) },
            },
            audit: {
              detail: bundles.map((b) => `last four ${b.lastFour}`).join(" / "),
            },
          };

          const emitted = redactHomeContent(homeContent, {
            salt: TEST_SALT,
            knownPhones: bundles.map((b) => b.raw),
            minFragmentDigits: MIN_FRAGMENT,
          });

          assertNoRawPhoneSurvives(emitted, bundles.map((b) => b.digits));
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 8.c — combined: complete + fragments across all three egress surfaces ──

  it("no raw phone digit sequence survives across mixed Briefing / SSE / audit payloads", () => {
    fc.assert(
      fc.property(
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 3 }),
        fc.array(formattedPhoneArb, { minLength: 0, maxLength: 3 }),
        fc.array(benignWordArb, { minLength: 0, maxLength: 5 }),
        (bundles, formatted, words) => {
          const knownPhones = [...bundles.map((b) => b.raw), ...formatted];

          const homeContent = {
            // Briefing content (Req 2.7) — deeply nested Stack + recap.
            briefing: {
              greeting:
                `${words.join(" ")} reach lead at ${bundles[0].raw}, ` +
                `or the one ending in ${bundles[0].lastFour}.`,
              recap: {
                completed: bundles.map((b, i) => ({
                  id: `done-${i}`,
                  title: `called ${b.raw} (ref ${b.fragment})`,
                })),
                outstanding: { nested: { deep: formatted.map((p) => `dial ${p}`) } },
              },
            },
            // SSE_Event_Bus payload (Req 13.4).
            sse_event: {
              type: "stack.item.added",
              payload: {
                leads: bundles.map((b, i) => ({
                  partyId: `party-${i}`,
                  note: `call ${b.raw} (ref ${b.fragment})`,
                  tail: `ends ${b.lastFour}`,
                })),
                formattedContacts: formatted.map((p) => `dial ${p}`),
              },
            },
            // Audit_Log record (Req 9.4).
            audit_record: {
              action: "add_stack_item",
              actor: "agent:home-twin",
              detail: [
                ...bundles.map((b) => `lead ${b.raw}`),
                ...formatted.map((p) => `alt ${p}`),
              ],
            },
          };

          const emitted = redactHomeContent(homeContent, {
            salt: TEST_SALT,
            knownPhones,
            minFragmentDigits: MIN_FRAGMENT,
          });

          assertNoRawPhoneSurvives(emitted, [
            ...bundles.map((b) => b.digits),
            ...formatted.map(toDigits),
          ]);

          // Redaction changes only string content, never structure.
          expect(Object.keys(emitted)).toEqual(Object.keys(homeContent));
          expect(emitted.sse_event.payload.leads.length).toBe(bundles.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 8.d — numeric figures (and non-string data) pass through unchanged ─────

  it("leaves numeric Briefing figures and non-string data untouched while redacting phone strings", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 3 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 4 }),
        (figures, bundles, flags) => {
          const homeContent = {
            figures, // metrics_* figures — must be byte-identical after redaction (Req 14 spirit)
            flags,
            empty: null,
            narration: bundles
              .map((b) => `call ${b.raw} ending in ${b.lastFour}`)
              .join(" "),
          };

          const emitted = redactHomeContent(homeContent, {
            salt: TEST_SALT,
            knownPhones: bundles.map((b) => b.raw),
            minFragmentDigits: MIN_FRAGMENT,
          });

          expect(emitted.figures).toEqual(figures);
          expect(emitted.flags).toEqual(flags);
          expect(emitted.empty).toBeNull();

          assertNoRawPhoneSurvives(
            { narration: emitted.narration },
            bundles.map((b) => b.digits),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── 8.e — the re-exported shared helpers behave identically on the home path ─

  it("redactPhones / redactPhonesInString (re-exported) redact complete numbers and last-four fragments in a single narration string", () => {
    fc.assert(
      fc.property(phoneBundleArb, benignWordArb, (bundle, word) => {
        const text = `${word}: reach ${bundle.raw} or the lead ending in ${bundle.lastFour}.`;
        const opts = {
          salt: TEST_SALT,
          knownPhones: [bundle.raw],
          minFragmentDigits: MIN_FRAGMENT,
        };

        const viaString = redactPhonesInString(text, opts);
        const viaObject = redactPhones({ text }, opts).text;
        const viaHome = redactHomeContent({ text }, opts).text;

        // The home named entry point IS the shared helper — identical output.
        expect(viaHome).toBe(viaObject);

        for (const redacted of [viaString, viaObject, viaHome]) {
          assertNoRawPhoneSurvives({ redacted }, [bundle.digits]);
          expect(
            redacted.includes("phone_hash:") ||
              redacted.includes(REDACTED_PHONE_MARKER),
          ).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
