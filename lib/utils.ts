// ── Class name helper ────────────────────────────────────────────────────────
// Lightweight `cn` that filters falsy values and joins class names. Avoids a
// hard dependency on clsx/tailwind-merge while keeping the shadcn-style API.

type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
    } else {
      out.push(String(input));
    }
  }
  return out.join(' ');
}
