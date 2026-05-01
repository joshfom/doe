// ── Language Detector ─────────────────────────────────────────────────────────
//
// Detects whether a text input is Arabic or English using a Unicode-based
// heuristic. Arabic characters in the range U+0600–U+06FF are counted and
// compared against the total character count (excluding whitespace).
// If the Arabic character ratio exceeds 30%, the text is classified as Arabic.

const ARABIC_REGEX = /[\u0600-\u06FF]/g;

/**
 * Detect the language of the given text.
 *
 * Uses a simple heuristic: count characters in the Arabic Unicode block
 * (U+0600–U+06FF) and compare to total non-whitespace characters.
 * If the ratio exceeds 30%, the text is classified as Arabic; otherwise English.
 *
 * @param text — the input text to classify
 * @returns `"ar"` for Arabic, `"en"` for English
 */
export function detectLanguage(text: string): "en" | "ar" {
  const stripped = text.replace(/\s/g, "");

  if (stripped.length === 0) {
    return "en";
  }

  const arabicMatches = stripped.match(ARABIC_REGEX);
  const arabicCount = arabicMatches ? arabicMatches.length : 0;
  const ratio = arabicCount / stripped.length;

  return ratio > 0.3 ? "ar" : "en";
}
