import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DataResidency } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { DRIVERS } from '../../infra/providers/localization-translation/drivers';
import { TRANSLATION_BREAKER } from '../../infra/providers/localization-translation/redis-stores';
import type {
  BreakerStore,
  TranslationDriver,
} from '../../infra/providers/localization-translation/translation-driver.port';
import { PlatformSettingsService, PlatformStore } from '../auth';
import { ProviderCredentials } from './provider-credentials';
import { buildChain, type ProviderRow, type RoutePolicy } from './translation-policy';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('provider_snapshots');

export const OFFICIAL_ONLY_KEY = 'i18n.official_only';
const SNAPSHOT_MS = 5_000;
/** Per provider call. A provider slower than this has effectively failed, as in Reference (4 s). */
export const DRIVER_TIMEOUT_MS = 4_000;

export interface TranslationContext {
  /** The workspace the text belongs to. Null for platform-level calls (no residency filter, no usage row). */
  orgId: number | null;
}

interface DbRow {
  id: number | string;
  slug: string;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  credentials: string | null;
}

/**
 * Decides which providers may see a piece of text and builds the drivers for it (TW-I18N-018, 019, 020).
 *
 * The provider table is platform data reachable only through PlatformStore. Its rows are held for five seconds in this
 * process (the admin service drops the snapshot on every write), so a busy inbox is not one extra query per message
 * while an operator's change still applies at once on the instance that took it. Residency is read from the calling
 * workspace explicitly: Reference consulted whoever happened to be logged in, which silently skipped it for webhooks,
 * queue jobs and the backfill.
 */
@Injectable()
export class ProviderRouterService {
  private snapshot: { at: number; rows: ProviderRow[] } | null = null;

  constructor(
    private readonly store: PlatformStore,
    private readonly db: DatabaseService,
    private readonly settings: PlatformSettingsService,
    private readonly credentials: ProviderCredentials,
    @Inject(TRANSLATION_BREAKER) private readonly breaker: BreakerStore,
  ) {}

  invalidate(): void {
    this.snapshot = null;
  }

  private async rows(): Promise<ProviderRow[]> {
    if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_MS) {
      cache.hit();
      return this.snapshot.rows;
    }
    cache.miss();
    const res = await this.store.tx((tx) =>
      tx.execute(
        sql`SELECT id, slug, is_active, is_default, sort_order, credentials FROM translation_providers`,
      ),
    );
    const rows = (res.rows as unknown as DbRow[]).map((r) => ({
      slug: r.slug,
      isActive: r.is_active,
      isDefault: r.is_default,
      sortOrder: r.sort_order,
      rank: Number(r.id),
      credentials: this.credentials.decrypt(r.slug, r.credentials),
    }));
    this.snapshot = { at: Date.now(), rows };
    return rows;
  }

  private async residency(orgId: number | null): Promise<DataResidency> {
    if (orgId === null) return 'any';
    try {
      const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
        tx.execute(sql`SELECT data_residency FROM workspace_settings WHERE org_id = ${orgId}`),
      );
      const value = (res.rows[0] as { data_residency?: string } | undefined)?.data_residency;
      return value === 'eu_only' || value === 'local' ? value : 'any';
    } catch {
      // An unreadable setting must not turn a restricted workspace into an unrestricted one.
      return 'local';
    }
  }

  async policy(ctx: TranslationContext): Promise<RoutePolicy> {
    const [lockdown, residency] = await Promise.all([
      this.settings.get<boolean>(OFFICIAL_ONLY_KEY),
      this.residency(ctx.orgId),
    ]);
    return { lockdown: lockdown === true, residency };
  }

  /** The drivers to try, in order, for this workspace. */
  async drivers(policy: RoutePolicy): Promise<TranslationDriver[]> {
    const chain = buildChain(await this.rows(), policy);
    const deps = { fetch: globalThis.fetch, breaker: this.breaker, timeoutMs: DRIVER_TIMEOUT_MS };
    return chain.map((e) => DRIVERS[e.slug].create(e.credentials, deps));
  }

  /** Name of the first provider a translation would try (display only). */
  async engineName(policy: RoutePolicy): Promise<string | null> {
    const chain = buildChain(await this.rows(), policy);
    const first = chain[0]?.slug;
    if (!first) return null;
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT name FROM translation_providers WHERE slug = ${first}`),
    );
    return (res.rows[0] as { name?: string } | undefined)?.name ?? 'MyMemory';
  }
}
