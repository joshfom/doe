import { db } from "./db";
import { seedNews } from "./seed/news";

async function main() {
  console.log("[seed:news] Seeding news posts…");
  const result = await seedNews(db);
  console.log("[seed:news] Done:", result);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:news] Failed:", err);
  process.exit(1);
});
