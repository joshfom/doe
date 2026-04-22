import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/cms/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  out: "./drizzle",
});
