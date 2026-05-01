import { db } from "./db";
import { users, roles, userRoles } from "./schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const email = process.argv[2];
  const roleName = process.argv[3] ?? "super_admin";

  if (!email) {
    console.error("Usage: bun lib/cms/grant-role.ts <email> [roleName]");
    console.error("Example: bun lib/cms/grant-role.ts admin@ora-uae.com super_admin");
    process.exit(1);
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, userType: users.userType })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const [role] = await db
    .select({ id: roles.id, userType: roles.userType })
    .from(roles)
    .where(and(eq(roles.name, roleName), eq(roles.userType, user.userType)))
    .limit(1);

  if (!role) {
    console.error(
      `No role '${roleName}' for userType '${user.userType}'. Run the API once so seedRbac populates roles.`,
    );
    process.exit(1);
  }

  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId: role.id })
    .onConflictDoNothing();

  console.log(`Granted '${roleName}' to ${user.name} <${email}>.`);
  console.log(
    "\nNote: the API server has its own in-process permission cache (5min TTL).\n" +
      "      Sign out and sign back in to refresh — the login handler busts the\n" +
      "      cache for this user automatically.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("grant-role failed:", err);
  process.exit(1);
});
