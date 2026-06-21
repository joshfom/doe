/**
 * Runner for the demo market catalog seed.
 *   bun run --env-file=.env lib/cms/run-seed-market-demo.ts
 * (or `npm run db:seed:market`).
 *
 * Idempotent: re-running upserts the same rows field-identically.
 */
import { db } from "./db";
import { seedMarketDemo } from "./seed/market-demo";

async function main() {
  console.log("[seed:market] Seeding demo market catalog (demo=true)…");
  const summary = await seedMarketDemo(db);
  console.table(summary);
  console.log("[seed:market] Done. find_comparables / market_comps now return data.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:market] Failed:", err);
  process.exit(1);
});
