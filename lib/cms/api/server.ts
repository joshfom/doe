import { api } from "./index";
import { db } from "../db";
import { seedSystemPages } from "../seed";
import { seedRbac } from "../rbac/seed";
import { seedTicketPermissions } from "../tickets/seed";
import { seedCommunityProjectPermissions } from "../communities/seed";
import { migrateExistingUsers } from "../rbac/migration";
import { purgeExpiredTrash } from "../blog/trash-purge";
import { seedAiPermissions } from "../ai/seed";

const port = Number(process.env.API_PORT) || 3001;

try {
  await seedSystemPages(db);
} catch (err) {
  console.error("Seeder failed:", err);
}

try {
  await seedRbac(db);
} catch (err) {
  console.error("RBAC seeder failed:", err);
}

try {
  await seedTicketPermissions(db);
} catch (err) {
  console.error("Ticket permissions seeder failed:", err);
}

try {
  await seedCommunityProjectPermissions(db);
} catch (err) {
  console.error("Community/project permissions seeder failed:", err);
}

try {
  await seedAiPermissions(db);
} catch (err) {
  console.error("AI permissions seeder failed:", err);
}

try {
  await migrateExistingUsers(db);
} catch (err) {
  console.error("RBAC user migration failed:", err);
}

try {
  const purged = await purgeExpiredTrash(db);
  console.log(`Trash auto-purge: ${purged} expired post(s) removed`);
} catch (err) {
  console.error("Trash auto-purge failed:", err);
}

api.listen(port);

console.log(`ORA CMS API running at http://localhost:${port}`);
