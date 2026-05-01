import { db } from "./db";
import { seedDemo } from "./seed/demo";

async function main() {
  console.log("[seed:demo] Seeding demo data…");
  const summary = await seedDemo(db);
  console.log("[seed:demo] Done:");
  console.table(summary);
  console.log(
    "\n[seed:demo] Knowledge documents are seeded WITHOUT embeddings.\n" +
      "           Run 'Re-embed All' from /ora-panel/ai/knowledge-base after\n" +
      "           CF_AI_GATEWAY_URL + CF_AI_API_TOKEN are configured."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:demo] Failed:", err);
  process.exit(1);
});
