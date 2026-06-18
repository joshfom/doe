import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// One-time startup breadcrumb so it's unambiguous WHICH database this process
// actually connected to. A running Node/Bun process captures DATABASE_URL at
// startup, so editing `.env` (e.g. switching between a cloud and a local DB)
// has no effect until the process is restarted — this log makes that visible.
// Credentials are masked; only host + database name are printed.
try {
  const u = new URL(connectionString);
  console.log(
    `[db] connected to ${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`
  );
} catch {
  console.log("[db] DATABASE_URL is set (unparseable for logging)");
}

export const db = drizzle(connectionString, { schema });
export type Database = typeof db;
