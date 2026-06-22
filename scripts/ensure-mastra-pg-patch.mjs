/**
 * Postinstall guard: fix the @mastra/pg spans-table init bug across ANY package
 * manager.
 *
 * @mastra/pg@1.13.0 creates `mastra_ai_spans` already carrying a primary key,
 * then a migration tries to ADD a second PRIMARY KEY under a specific name —
 * and its existence check only looks for THAT constraint name, missing the PK
 * already present. Result: `42P16 multiple primary keys` on every init, which
 * crashes the agent memory-prep step (the "home assistant could not be reached"
 * symptom).
 *
 * The repo also ships a `bun patch` (patches/) for the same fix, but Dokploy's
 * Nixpacks build installs with `npm ci`, which ignores bun's
 * `patchedDependencies`. This postinstall runs under BOTH npm and bun, so the
 * fix is applied no matter how dependencies are installed. It is idempotent:
 * if the file is already patched (by bun patch or a prior run) it does nothing.
 *
 * The fix: make `spansPrimaryKeyExists()` return true when the spans table has
 * ANY primary key, so the broken `ALTER TABLE … ADD PRIMARY KEY` is skipped.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..", "node_modules", "@mastra", "pg", "dist");
const targets = ["index.js", "index.cjs"];

// Marker proving the fix is already in place (idempotency guard).
const PATCHED_MARKER = "t.relname = 'mastra_ai_spans'";

// The fixed method body (shared by both the ESM and CJS builds — the only
// difference between them is the helper import, which the fix removes anyway).
const FIXED_METHOD = `async spansPrimaryKeyExists() {
    const schemaFilter = this.schemaName || "public";
    const result = await this.client.oneOrNone(
      \`SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE c.contype = 'p' AND t.relname = 'mastra_ai_spans' AND n.nspname = $1) as exists\`,
      [schemaFilter]
    );
    return result?.exists ?? false;
  }`;

// Matches the original method from the method name to its `return` line,
// non-greedily so it never swallows a neighbouring method.
const METHOD_RE =
  /async spansPrimaryKeyExists\(\) \{[\s\S]*?return result\?\.exists \?\? false;\n {2}\}/;

let patchedAny = false;
let skipped = 0;

for (const file of targets) {
  const full = join(pkgDir, file);
  if (!existsSync(full)) continue;

  const src = readFileSync(full, "utf8");

  if (src.includes(PATCHED_MARKER)) {
    skipped += 1;
    continue; // already patched (bun patch or a previous postinstall run)
  }

  if (!METHOD_RE.test(src)) {
    console.warn(
      `[ensure-mastra-pg-patch] ${file}: spansPrimaryKeyExists not found in the expected shape — skipping (mastra/pg may have changed version).`
    );
    continue;
  }

  writeFileSync(full, src.replace(METHOD_RE, FIXED_METHOD), "utf8");
  console.log(`[ensure-mastra-pg-patch] patched ${file}`);
  patchedAny = true;
}

if (!patchedAny && skipped > 0) {
  console.log("[ensure-mastra-pg-patch] already applied — nothing to do.");
}
// Never fail the install: a missing/changed @mastra/pg should not block deploys.
process.exit(0);
