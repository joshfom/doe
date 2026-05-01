import { Elysia } from "elysia";
import { authGuard } from "../auth";
import { users } from "../../schema";
import { db } from "../../db";

export const usersRoutes = new Elysia({ name: "users" })
  .use(authGuard)

  // GET /users — return all users (id, name, email) for pickers
  .get("/users", async () => {
    const result = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users);

    return { data: result };
  });
