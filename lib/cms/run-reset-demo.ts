import { db } from "./db";
import { resetDemo } from "./seed/demo";

async function main() {
  console.log("[seed:demo:reset] Removing seeded demo data…");
  const summary = await resetDemo(db);
  console.log("[seed:demo:reset] Done:");
  console.table(summary);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:demo:reset] Failed:", err);
  process.exit(1);
});
