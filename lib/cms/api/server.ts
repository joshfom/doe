import { api } from "./index";
import { db } from "../db";
import { seedSystemPages } from "../seed";

const port = Number(process.env.API_PORT) || 3001;

try {
  await seedSystemPages(db);
} catch (err) {
  console.error("Seeder failed:", err);
}

api.listen(port);

console.log(`ORA CMS API running at http://localhost:${port}`);
