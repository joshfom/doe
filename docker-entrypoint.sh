#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Container entrypoint: wait for Postgres, run DB migrations, then exec the
# main process (next start). Migrations are idempotent (see
# scripts/migrate-direct.ts), so this is safe to run on every boot.
# ---------------------------------------------------------------------------

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL is not set — skipping migrations" >&2
  else
    echo "[entrypoint] waiting for the database to accept connections..."
    # Retry the migration runner; it fails fast if the DB isn't reachable yet.
    attempts=0
    max_attempts="${MIGRATE_MAX_ATTEMPTS:-30}"
    until bun run scripts/migrate-direct.ts; do
      attempts=$((attempts + 1))
      if [ "$attempts" -ge "$max_attempts" ]; then
        echo "[entrypoint] migrations failed after ${attempts} attempts" >&2
        exit 1
      fi
      echo "[entrypoint] migration attempt ${attempts} failed, retrying in 2s..."
      sleep 2
    done
    echo "[entrypoint] migrations complete"
  fi
fi

echo "[entrypoint] starting: $*"
exec "$@"
