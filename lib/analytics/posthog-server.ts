import { PostHog } from "posthog-node";

let posthogServerInstance: PostHog | null = null;

/**
 * Returns a singleton PostHog server-side client configured for EU Cloud.
 * Returns null if the PostHog API key is not set.
 */
export function getPostHogServer(): PostHog | null {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

  if (!apiKey) {
    return null;
  }

  if (!posthogServerInstance) {
    posthogServerInstance = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 20,
      flushInterval: 10000,
    });

    process.on("beforeExit", async () => {
      await posthogServerInstance?.shutdown();
    });
  }

  return posthogServerInstance;
}
