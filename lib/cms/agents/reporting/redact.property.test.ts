import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  redactPhones,
  redactPhonesInString,
  REDACTED_PHONE_MARKER,
} from "./redact";

/**
 * Feature: agentic-reporting-twin, Property 12: No raw phone number ever leaves the agent
 *
 * *For any* content the Reporting_Agent is about to narrate, publish to the
 * SSE_Event_Bus, or write to the Audit_Log, and *for any* Chart_Artifact or
 * Report_Export it produces, no raw phone number — complete or as any digit
 * substring including a last-four fragment — appears; phone-shaped values are
 * redacted to a salted `phone_hash` before emission, and reporting tool outputs
 * expose phone only as `phoneHash`.
 *
 * **Validates: Requirements 6.4, 7.6, 10.2, 12.1, 12.2, 12.3, 12.4**
 *
 * The implementation under test is the PURE, recursive redaction module
 * `lib/cms/agents/reporting/redact.ts` (`redactPhones` / `redactPhonesInString`).
 * These tests treat it as a black box and verify the privacy guarantee with an
 * INDEPENDENT oracle: after redaction, the literal raw phone digit sequences we
 * injected — full numbers AND last-four / longer fragments — must not survive
 * anywhere in the emitted structure, once the legitimate redaction tokens
 * (`phone_hash:<hex>` and the `[redacted-phone]` marker) are removed.
 */

// ── Test salt (hermetic — never reads process.env) ───────────────────────────

const TEST_SALT = "doe-reporting-twin-test-salt";
const MIN_FRAGMENT = 4; // last-four is the smallest redactable fragment (Req 12.1)

// ── Oracle helpers ───────────────────────────────────────────────────────────

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
 * Replace every legitimate redaction token with a space separator so the hex of
 * a `phone_hash:` value is never scanned and adjacent digits cannot merge across
 * a removed token. What remains is the "raw" residue the agent would actually
 * emit beyond its sanctioned tokens.
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
 * known phone digit sequence — i.e. `run` still carries a redactable fragment of
 * that phone (a last-four or longer). The privacy oracle: no surviving run may
 * carry any such window.
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
  "pipeline",
  "qualified",
  "cost-per-lead",
  "follow-up",
  "stale",
  "HOT-tier",
  "this-week",
  "summary",
  "reach out",
  "ending in",
  "call",
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
  // A contiguous fragment of length 4..digits.length starting somewhere valid.
  return fc
    .tuple(
      fc.integer({ min: 4, max: digits.length }),
      fc.nat(),
    )
    .map(([fragLen, startSeed]) => {
      const maxStart = digits.length - fragLen;
      const start = maxStart > 0 ? startSeed % (maxStart + 1) : 0;
      const fragment = digits.slice(start, start + fragLen);
      return { raw, digits, lastFour, fragment };
    });
});

// ── Property 12.a — complete numbers redacted even with NO known phones ──────

// Feature: agentic-reporting-twin, Property 12: No raw phone number ever leaves the agent
describe("Feature: agentic-reporting-twin, Property 12: No raw phone number ever leaves the agent", () => {
  it("redacts complete phone numbers nested anywhere in agent output, with no phones in working context", () => {
    fc.assert(
      fc.property(
        fc.array(e164Arb, { minLength: 1, maxLength: 4 }),
        fc.array(benignWordArb, { minLength: 0, maxLength: 6 }),
        (phones, words) => {
          // Build a nested narration/SSE/audit/artifact structure that embeds
          // each complete phone as a STANDALONE token (space-delimited) — the
          // shape the complete-token sanitiser is designed to catch — WITHOUT
          // supplying knownPhones (the realistic case: the agent holds no raw
          // phone, only hashes — Requirement 12.2).
          const sentence = (p: string) => `${words.join(" ")} call ${p} now`;
          const payload = {
            narration: sentence(phones[0]),
            sse: {
              type: "agent.tool.called",
              payload: { note: phones.map((p) => `lead ${p}`).join("; ") },
            },
            audit: { action: "query_leads", detail: sentence(phones[phones.length - 1]) },
            artifact: {
              kind: "pdf",
              caption: phones.map((p) => `contact ${p}`),
            },
          };

          const emitted = redactPhones(payload, { salt: TEST_SALT });

          assertNoRawPhoneSurvives(
            emitted,
            phones.map(toDigits),
          );

          // And the sanctioned token convention is what replaced them: every
          // emitted string that held a phone now carries a phone_hash token
          // (salt is configured) rather than a raw number.
          const flat = collectStrings(emitted).join(" ");
          expect(flat.includes("phone_hash:")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property 12.b — fragments incl. last-four redacted when phones in context

  it("redacts phone fragments including the last-four when the source phones are in working context", () => {
    fc.assert(
      fc.property(
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 4 }),
        (bundles) => {
          // Inject ONLY fragments (last-four and longer) — never the complete
          // number — embedded inside arbitrary free text. The complete-token
          // pass cannot tell a bare 4-digit run from a metric figure, so this
          // path exercises the knownPhones fragment pass (Requirement 12.1,
          // 12.3, 12.4).
          const payload = {
            narration: bundles
              .map((b) => `the lead ending in ${b.lastFour} is stale`)
              .join(" "),
            sse: {
              payload: {
                fragments: bundles.map((b) => `ref${b.fragment}x`),
              },
            },
            audit: {
              detail: bundles.map((b) => `last four ${b.lastFour}`).join(" / "),
            },
          };

          const emitted = redactPhones(payload, {
            salt: TEST_SALT,
            knownPhones: bundles.map((b) => b.raw),
            minFragmentDigits: MIN_FRAGMENT,
          });

          assertNoRawPhoneSurvives(
            emitted,
            bundles.map((b) => b.digits),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property 12.c — combined: complete + fragments across all payload types ─

  it("no raw phone digit sequence survives across mixed narration / SSE / audit / artifact payloads", () => {
    fc.assert(
      fc.property(
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 3 }),
        fc.array(formattedPhoneArb, { minLength: 0, maxLength: 3 }),
        fc.array(benignWordArb, { minLength: 0, maxLength: 5 }),
        (bundles, formatted, words) => {
          const knownPhones = [
            ...bundles.map((b) => b.raw),
            ...formatted,
          ];

          // A deeply-nested structure mixing: complete raw numbers, formatted
          // numbers, last-four fragments, longer fragments, benign prose, and
          // arbitrary nesting — every emission surface the agent touches.
          const payload = {
            narration:
              `${words.join(" ")} reach lead at ${bundles[0].raw}, ` +
              `or the one ending in ${bundles[0].lastFour}.`,
            sse_event: {
              type: "agent.decision",
              payload: {
                leads: bundles.map((b, i) => ({
                  partyId: `party-${i}`,
                  note: `call ${b.raw} (ref ${b.fragment})`,
                  tail: `ends ${b.lastFour}`,
                })),
                formattedContacts: formatted.map((p) => `dial ${p}`),
              },
            },
            audit_record: {
              action: "query_leads",
              actor: "agent:reporting-twin",
              detail: [
                ...bundles.map((b) => `lead ${b.raw}`),
                ...formatted.map((p) => `alt ${p}`),
              ],
            },
            artifact: {
              kind: "report",
              sections: [
                { heading: "Stale leads", body: bundles.map((b) => b.lastFour) },
                { heading: "Contacts", body: { nested: { deep: bundles.map((b) => b.raw) } } },
              ],
            },
          };

          const emitted = redactPhones(payload, {
            salt: TEST_SALT,
            knownPhones,
            minFragmentDigits: MIN_FRAGMENT,
          });

          assertNoRawPhoneSurvives(emitted, [
            ...bundles.map((b) => b.digits),
            ...formatted.map(toDigits),
          ]);

          // The emitted structure preserves shape (keys + nesting) — redaction
          // changes only string content, never structure.
          expect(Object.keys(emitted)).toEqual(Object.keys(payload));
          expect(emitted.artifact.sections.length).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property 12.d — numeric figures (and non-string data) pass through ──────

  it("leaves numeric analytics figures and non-string data untouched while redacting phone strings", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.array(phoneBundleArb, { minLength: 1, maxLength: 3 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 4 }),
        (figures, bundles, flags) => {
          const payload = {
            figures, // JS numbers — must be byte-identical after redaction (Req 8.3 spirit)
            flags,
            empty: null,
            narration: bundles
              .map((b) => `call ${b.raw} ending in ${b.lastFour}`)
              .join(" "),
          };

          const emitted = redactPhones(payload, {
            salt: TEST_SALT,
            knownPhones: bundles.map((b) => b.raw),
            minFragmentDigits: MIN_FRAGMENT,
          });

          // Numeric figures are analytics data, never phone text: unchanged.
          expect(emitted.figures).toEqual(figures);
          expect(emitted.flags).toEqual(flags);
          expect(emitted.empty).toBeNull();

          // Phones still fully redacted from the narration string.
          assertNoRawPhoneSurvives(
            { narration: emitted.narration },
            bundles.map((b) => b.digits),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // ── Property 12.e — string convenience form matches object form ─────────────

  it("redactPhonesInString redacts complete numbers and last-four fragments in a single narration string", () => {
    fc.assert(
      fc.property(phoneBundleArb, benignWordArb, (bundle, word) => {
        const text = `${word}: reach ${bundle.raw} or the lead ending in ${bundle.lastFour}.`;

        const redacted = redactPhonesInString(text, {
          salt: TEST_SALT,
          knownPhones: [bundle.raw],
          minFragmentDigits: MIN_FRAGMENT,
        });

        assertNoRawPhoneSurvives({ redacted }, [bundle.digits]);

        // Something was redacted — either a hash token or the marker is present.
        expect(
          redacted.includes("phone_hash:") ||
            redacted.includes(REDACTED_PHONE_MARKER),
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
