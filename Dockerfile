# syntax=docker/dockerfile:1

# ============================================================================
# Production-style image for the Next.js 16 app (Elysia API is mounted inside
# Next via the app/api/[...slugs] catch-all route, so a single process serves
# both the site and the API). Toolchain is Bun, matching the repo's bun.lock.
# ============================================================================

ARG BUN_VERSION=1.3.11

# ---- Base: shared bun runtime ---------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- Dependencies: full install (incl. devDeps needed to build) -----------
FROM base AS deps
# sharp needs libc/vips at runtime; build also benefits from these.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
# Patched dependencies (bun applies these during install; the files must be
# present before `bun install` runs or the patch is silently skipped).
COPY patches ./patches
# Install with the lockfile frozen so the image matches the committed deps.
# NODE_ENV=development ensures devDependencies (next build, tailwind) install.
RUN NODE_ENV=development bun install --frozen-lockfile

# ---- Builder: compile the Next.js production bundle -----------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* variables are inlined into the client bundle at build time.
# Pass them as build args so the browser bundle points at the right hosts.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_REVERSE_PROXY
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_CLARITY_ID
ARG NEXT_PUBLIC_GA4_ID
ARG NEXT_PUBLIC_META_PIXEL_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_REVERSE_PROXY=$NEXT_PUBLIC_POSTHOG_REVERSE_PROXY \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID \
    NEXT_PUBLIC_GA4_ID=$NEXT_PUBLIC_GA4_ID \
    NEXT_PUBLIC_META_PIXEL_ID=$NEXT_PUBLIC_META_PIXEL_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# ---- Runner: production runtime image -------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring over installed deps and the compiled app. We ship the full node_modules
# (rather than Next standalone output) because the app relies on native/bun
# tooling — `pg`, `sharp`, and the bun-run drizzle migration script.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Local-storage backend writes here; declared so it survives as a volume.
RUN mkdir -p public/uploads && chown -R bun:bun public/uploads
VOLUME ["/app/public/uploads"]

USER bun
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
