import { defaultRobotsTxt } from "@/lib/cms/sitemap/config";

// Serve robots.txt verbatim from the admin-managed text. Using a Route Handler
// (instead of Next's robots.ts object form) means whatever an editor types in
// the Sitemap Manager is what crawlers receive — byte for byte.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3000";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.SITE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

export async function GET() {
  let body: string | null = null;

  try {
    const res = await fetch(`${API_BASE_URL}/api/sitemap/robots`, {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      const text = json?.data?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        body = text;
      }
    }
  } catch {
    // fall through to default
  }

  if (body === null) {
    body = defaultRobotsTxt(SITE_URL);
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
