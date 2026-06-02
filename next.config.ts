import type { NextConfig } from "next";

const posthogHost = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
// Derive the assets host: https://us.i.posthog.com → https://us-assets.i.posthog.com
const posthogAssetsHost = posthogHost.replace("://us.", "://us-assets.").replace("://eu.", "://eu-assets.");

const nextConfig: NextConfig = {
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,

  turbopack: {
    // `lib/page-builder/richtext/sanitize.ts` is isomorphic and gets pulled into
    // the CLIENT bundle via the `"use client"` `config.ts`. Its server branch
    // calls `require("jsdom")` (guarded at runtime by a `typeof window` check),
    // but Turbopack still statically follows that require when building the
    // browser bundle — dragging in jsdom and its Node-only `fs` dependency and
    // failing with "Module not found: Can't resolve 'fs'".
    //
    // Alias jsdom to an inert stub ONLY under the `browser` condition so the
    // client bundle no longer resolves it. On the server jsdom resolves normally
    // (it is in Next's default `serverExternalPackages` list).
    resolveAlias: {
      jsdom: { browser: "./lib/page-builder/richtext/jsdom.browser-stub.ts" },
    },
  },

  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: `${posthogAssetsHost}/static/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${posthogHost}/:path*`,
      },
    ];
  },
};

export default nextConfig;
