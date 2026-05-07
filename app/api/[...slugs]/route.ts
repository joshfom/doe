import { api } from "@/lib/cms/api";

// Force the Node.js runtime + dynamic execution for every request.
//
// Without these hints, Vercel can route the catch-all through the
// build-time/Edge optimizer, which strips Set-Cookie headers and
// breaks the auth session — producing 401s in production for
// authenticated POSTs (e.g. /pages/:id/clone-locale) that work
// locally over plain HTTP.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = api.handle;

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
