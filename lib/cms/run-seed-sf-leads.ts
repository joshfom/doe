/**
 * Entry point for the Salesforce lead seeder.
 *
 *   bun run --env-file=.env lib/cms/run-seed-sf-leads.ts            # pull 50 from SF
 *   bun run --env-file=.env lib/cms/run-seed-sf-leads.ts --limit=100
 *   bun run --env-file=.env lib/cms/run-seed-sf-leads.ts --simulate # synthetic only
 *   bun run --env-file=.env lib/cms/run-seed-sf-leads.ts --reset    # remove seeded leads
 *
 * On a Salesforce pull failure (auth/network/empty) it falls back to simulate
 * mode unless `--no-fallback` is passed.
 */
import { db } from "./db";
import {
  clearSalesforceLeadSeed,
  seedSalesforceLeads,
  type SeedMode,
} from "./seed/salesforce-leads";

function parseArgs(argv: string[]) {
  let limit = 50;
  let mode: SeedMode = "salesforce";
  let reset = false;
  let fallbackToSimulate = true;

  for (const arg of argv) {
    if (arg === "--simulate") mode = "simulate";
    else if (arg === "--reset") reset = true;
    else if (arg === "--no-fallback") fallbackToSimulate = false;
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }

  return { limit, mode, reset, fallbackToSimulate };
}

async function main() {
  const { limit, mode, reset, fallbackToSimulate } = parseArgs(process.argv.slice(2));

  if (reset) {
    console.log("[seed:sf-leads] Removing previously seeded Salesforce leads…");
    const summary = await clearSalesforceLeadSeed(db);
    console.table(summary);
    process.exit(0);
  }

  console.log(
    `[seed:sf-leads] Seeding up to ${limit} leads (mode: ${mode}${
      mode === "salesforce" && fallbackToSimulate ? ", simulate-fallback on" : ""
    })…`
  );
  const summary = await seedSalesforceLeads(db, { limit, mode, fallbackToSimulate });
  console.log("[seed:sf-leads] Done:");
  console.table(summary);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:sf-leads] Failed:", err);
  process.exit(1);
});
