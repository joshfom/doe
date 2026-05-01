// ── Types ────────────────────────────────────────────────────────────────────

export interface CachedPermissions {
  roles: string[];
  permissions: string[];
  cachedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 300_000; // 5 minutes

// ── Cache ────────────────────────────────────────────────────────────────────

export class PermissionCache {
  private cache = new Map<string, CachedPermissions>();
  private ttl: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttl = ttlMs;
  }

  get(userId: string): CachedPermissions | null {
    const entry = this.cache.get(userId);
    if (!entry) return null;
    if (entry.cachedAt + this.ttl <= Date.now()) {
      this.cache.delete(userId);
      return null;
    }
    return entry;
  }

  set(userId: string, data: Omit<CachedPermissions, "cachedAt">): void {
    this.cache.set(userId, {
      ...data,
      cachedAt: Date.now(),
    });
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
