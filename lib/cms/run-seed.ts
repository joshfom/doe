import { db } from "./db";
import { seedSystemPages } from "./seed";

async function main() {
  console.log("Running seeder...");
  await seedSystemPages(db);
  console.log("Seeder complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeder failed:", err);
  process.exit(1);
});
