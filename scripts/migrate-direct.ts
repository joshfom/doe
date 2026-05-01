/**
 * Direct migration runner for Neon — bypasses drizzle-kit which hangs on this
 * environment. Reads drizzle/meta/_journal.json, executes each SQL file
 * statement-by-statement (split on `--> statement-breakpoint`), and records
 * each applied migration in the `drizzle.__drizzle_migrations` table to stay
 * compatible with `drizzle-kit migrate`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface Journal {
  entries: JournalEntry[];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  // Strip channel_binding=require (causes pg quirks) and prefer direct host
  const cleanUrl = url
    .replace(/[?&]channel_binding=require/g, "")
    .replace("-pooler", "");

  const client = new Client({ connectionString: cleanUrl });
  await client.connect();
  console.log("[migrate] connected to", cleanUrl.replace(/:[^@:]+@/, ":***@"));

  const drizzleDir = join(process.cwd(), "drizzle");
  const journal: Journal = JSON.parse(
    readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf-8")
  );
  const sqlFiles = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Ensure migrations bookkeeping table exists
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const applied = await client.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations"
  );
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));

  for (const entry of journal.entries) {
    const file = sqlFiles.find((f) => f.startsWith(entry.tag));
    if (!file) {
      console.warn(`[migrate] no SQL file for ${entry.tag}, skipping`);
      continue;
    }
    const sqlPath = join(drizzleDir, file);
    const sql = readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    if (appliedHashes.has(hash)) {
      console.log(`[migrate] skip ${entry.tag} (already applied)`);
      continue;
    }

    console.log(`[migrate] apply ${entry.tag}…`);
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        // Tolerate "already exists" / "does not exist when dropping" errors so we can
        // continue applying schema-additive migrations on a partially-seeded DB.
        // Codes: 42P07 duplicate_table, 42710 duplicate_object, 42701 duplicate_column,
        //        42P06 duplicate_schema, 42704 undefined_object, 42703 undefined_column,
        //        42P01 undefined_table.
        const tolerable = new Set([
          "42P07",
          "42710",
          "42701",
          "42P06",
          "42704",
          "42703",
          "42P01",
        ]);
        if (e.code && tolerable.has(e.code)) {
          console.warn(
            `[migrate]   ⚠ ${e.code} ${e.message?.split("\n")[0]} — continuing`
          );
          continue;
        }
        console.error(`[migrate] FAIL on ${entry.tag}:`, e.message);
        console.error("  statement:", stmt.slice(0, 200));
        throw err;
      }
    }

    await client.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      [hash, entry.when]
    );
    console.log(`[migrate] ✓ ${entry.tag} (${statements.length} statements)`);
  }

  console.log("[migrate] done");
  await client.end();
}

main().catch((err) => {
  console.error("[migrate] error:", err);
  process.exit(1);
});
