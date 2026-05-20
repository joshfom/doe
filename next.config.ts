import type { NextConfig } from "next";

const posthogHost = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
// Derive the assets host: https://us.i.posthog.com → https://us-assets.i.posthog.com
const posthogAssetsHost = posthogHost.replace("://us.", "://us-assets.").replace("://eu.", "://eu-assets.");

const nextConfig: NextConfig = {
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,

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
