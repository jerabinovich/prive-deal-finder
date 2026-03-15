import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cache } from "cache-manager";
import { createHash } from "crypto";

const TTL_LIST    = 2 * 60 * 1000;  // 2 min — list changes frequently
const TTL_FACETS  = 5 * 60 * 1000;  // 5 min
const TTL_DEAL    = 5 * 60 * 1000;  // 5 min per-deal

function hashKey(prefix: string, params: unknown): string {
  const raw = typeof params === "string" ? params : JSON.stringify(params ?? {});
  const hash = createHash("sha1").update(raw).digest("hex").slice(0, 12);
  return `deals:${prefix}:${hash}`;
}

@Injectable()
export class DealsCacheService {
  private readonly logger = new Logger(DealsCacheService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  // ─── List ─────────────────────────────────────────────────────────────────

  async getList<T>(params: unknown, loader: () => Promise<T>): Promise<T> {
    const key = hashKey("list", params);
    return this.wrap(key, TTL_LIST, loader);
  }

  async getFacets<T>(params: unknown, loader: () => Promise<T>): Promise<T> {
    const key = hashKey("facets", params);
    return this.wrap(key, TTL_FACETS, loader);
  }

  // ─── Per-deal ─────────────────────────────────────────────────────────────

  async getDeal<T>(id: string, suffix: string, loader: () => Promise<T>): Promise<T> {
    const key = `deals:deal:${id}:${suffix}`;
    return this.wrap(key, TTL_DEAL, loader);
  }

  // ─── Invalidation ─────────────────────────────────────────────────────────

  /** Clear all list + facets cache (after create/backfill/triage) */
  async invalidateLists(): Promise<void> {
    await this.deletePattern("deals:list:");
    await this.deletePattern("deals:facets:");
  }

  /** Clear per-deal cache for a specific deal (after update/refresh/comps/insights) */
  async invalidateDeal(id: string): Promise<void> {
    await this.deletePattern(`deals:deal:${id}:`);
    // Also bust lists since deal data changed
    await this.invalidateLists();
  }

  /** Nuclear: clear everything (after bulk operations) */
  async invalidateAll(): Promise<void> {
    await this.deletePattern("deals:");
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async wrap<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.cache.get<T>(key);
      if (cached !== undefined && cached !== null) {
        this.logger.debug(`Cache HIT ${key}`);
        return cached;
      }
    } catch (error) {
      this.logger.warn(`Cache GET error for ${key}: ${error instanceof Error ? error.message : error}`);
    }

    const value = await loader();

    try {
      await this.cache.set(key, value, ttl);
      this.logger.debug(`Cache SET ${key} (ttl=${ttl}ms)`);
    } catch (error) {
      this.logger.warn(`Cache SET error for ${key}: ${error instanceof Error ? error.message : error}`);
    }

    return value;
  }

  private async deletePattern(prefix: string): Promise<void> {
    try {
      // cache-manager v5 doesn't expose scan natively; use store.client if available (ioredis)
      const store = (this.cache as unknown as { store?: { client?: { keys?: (p: string) => Promise<string[]>; del?: (...k: string[]) => Promise<number> } } }).store;
      const client = store?.client;
      if (client?.keys && client?.del) {
        const keys = await client.keys(`${prefix}*`);
        if (keys.length) await client.del(...keys);
        this.logger.debug(`Cache DEL pattern ${prefix}* (${keys.length} keys)`);
      } else {
        // In-memory store: no scan available — reset whole store
        await (this.cache as unknown as { reset?: () => Promise<void> }).reset?.();
        this.logger.debug(`Cache RESET (in-memory, pattern ${prefix}*)`);
      }
    } catch (error) {
      this.logger.warn(`Cache DEL pattern error for ${prefix}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
