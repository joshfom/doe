import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authPlugin } from "./auth";
import { pagesRoutes } from "./routes/pages";
import { revisionsRoutes } from "./routes/revisions";
import { mediaRoutes } from "./routes/media";
import { formsRoutes } from "./routes/forms";
import { settingsRoutes } from "./routes/settings";
import { auditRoutes } from "./routes/audit";

export const api = new Elysia({ prefix: "/api" })
  .use(cors())
  .use(authPlugin)
  .use(pagesRoutes)
  .use(revisionsRoutes)
  .use(mediaRoutes)
  .use(formsRoutes)
  .use(settingsRoutes)
  .use(auditRoutes);
