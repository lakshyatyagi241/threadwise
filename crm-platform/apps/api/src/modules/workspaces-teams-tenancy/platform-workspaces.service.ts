import { Inject, Injectable } from '@nestjs/common';
import type {
  ListWorkspaceHubQuery,
  SuspendWorkspaceHubRequest,
  WorkspaceHubDetail,
  WorkspaceHubKpis,
  WorkspaceHubListResponse,
  WorkspaceHubRow,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { WABA_ENV, type WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { PlatformSettingsService, PlatformStore } from '../auth';
import { Fx, monthlyOf, money2 } from '../dashboards-analytics-charts';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { PlatformInboxService } from '../platform-support-desk';
import { PlatformRbacService } from '../roles-permissions';
import { BillingCurrencyService, WalletSettingsService } from '../wallet-message-billing';
import { ProviderStore, chooseNewNumberProvider } from '../whatsapp-provider-registry';
import {
  decodeHubCursor,
  deliveredPct,
  daySpine,
  encodeHubCursor,
  fillSeries,
  hubCan,
  toHubRow,
  type HubContext,
  type HubRawRow,
} from './platform-workspaces.mapper';
import {
  PlatformWorkspacesRepository,
  type HubQueryContext,
} from './platform-workspaces.repository';

const BUILTIN_LABELS: Record<string, string> = {
  meta: 'Meta Cloud API (direct)',
  interakt: 'Interakt Partner API',
};

/**
 * The operator's Workspaces hub (TW-WSP-023/025): every customer workspace with the facts an operator acts on. It reads across
 * workspaces through the platform door (`PlatformStore`, behind the operator guards) and owns no table. Suspending and lifting go
 * through the platform inbox's own methods, so the flag, the status sync and the audit trail are the ones the inbox already writes.
 *
 * Marketplace subscription revenue is not part of MRR yet: it is the workspace's plan price only.
 */
@Injectable()
export class PlatformWorkspacesService {
  constructor(
    private readonly store: PlatformStore,
    private readonly repo: PlatformWorkspacesRepository,
    private readonly providers: ProviderStore,
    private readonly wallet: WalletSettingsService,
    private readonly billing: BillingCurrencyService,
    private readonly entitlements: PlanEntitlementService,
    private readonly settings: PlatformSettingsService,
    private readonly rbac: PlatformRbacService,
    private readonly inbox: PlatformInboxService,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  async list(q: ListWorkspaceHubQuery): Promise<WorkspaceHubListResponse> {
    const cursor = decodeHubCursor(q.cursor, q.sort);
    if (q.cursor && !cursor)
      throw AppError.validation('The cursor is not valid for this list.', [
        { path: 'cursor', message: 'Start again from the first page.' },
      ]);
    const query = await this.queryContext();
    const now = new Date();

    return this.store.tx(async (tx) => {
      const raw = await this.repo.list(tx, q, cursor, query.sql);
      const page = raw.slice(0, q.limit);
      const hasMore = raw.length > q.limit;
      const last = page[page.length - 1];

      const [facts, kpiCounts, planOptions, registry, freeLimits, fx] = await Promise.all([
        this.repo.pageFacts(
          tx,
          page.map((r) => Number(r.id)),
          now,
        ),
        this.repo.kpis(tx, query.sql),
        this.repo.planOptions(tx),
        this.providers.all(tx),
        this.repo.freePlanLimits(tx),
        this.fx(tx),
      ]);
      const ctx = this.rowContext(
        now,
        fx,
        query.sql.fallbackProviderKey,
        query.fallbackSource,
        registry,
        freeLimits,
      );

      const mrr = kpiCounts.paying.reduce(
        (sum, g) => sum + g.n * fx.toBase(monthlyOf(g), g.currency ?? fx.base),
        0,
      );
      const kpis: WorkspaceHubKpis = {
        total: kpiCounts.total,
        active: kpiCounts.active,
        suspended: kpiCounts.suspended,
        trial: kpiCounts.trial,
        newThisMonth: kpiCounts.newThisMonth,
        lowBalance: kpiCounts.lowBalance,
        mrr: money2(mrr),
        currency: fx.base,
      };

      const providerOptions = registry
        .filter((p) => p.status !== 'archived')
        .map((p) => ({ key: p.key, name: p.label }));
      // The built-in route the platform setting names stays selectable even when the registry has no row for it.
      if (!providerOptions.some((p) => p.key === query.sql.fallbackProviderKey))
        providerOptions.push({
          key: query.sql.fallbackProviderKey,
          name: BUILTIN_LABELS[query.sql.fallbackProviderKey] ?? query.sql.fallbackProviderKey,
        });

      return {
        data: page.map((r) => toHubRow(r, facts, ctx)),
        page: {
          nextCursor:
            hasMore && last
              ? encodeHubCursor({ sort: q.sort, v: last.sort_value ?? null, id: Number(last.id) })
              : null,
          hasMore,
          limit: q.limit,
        },
        kpis,
        filters: { plans: planOptions, providers: providerOptions },
      };
    });
  }

  async one(uuid: string): Promise<WorkspaceHubRow> {
    const { row, ctx, facts } = await this.loadRow(uuid);
    return toHubRow(row, facts, ctx);
  }

  async detail(uuid: string): Promise<WorkspaceHubDetail> {
    const operatorId = RequestContextStore.require().actorId;
    const operatorRole = RequestContextStore.require().operatorRole;
    const now = new Date();
    const { row, ctx, facts, extras } = await this.loadRow(uuid, now);
    const held = operatorId ? await this.rbac.permissionsOf(operatorId) : new Set<string>();
    const series = fillSeries(daySpine(now, 30), extras!.series);
    return {
      row: toHubRow(row, facts, ctx),
      members: extras!.members,
      contacts: extras!.contacts,
      openTickets: extras!.openTickets,
      messages30d: series,
      deliveredPct: deliveredPct(series),
      adminNote: row.admin_note ?? null,
      can: hubCan(held, operatorRole),
    };
  }

  /** Suspends through the inbox (frozen flag, status sync, audit), then returns the workspace as the hub shows it. */
  async suspend(uuid: string, body: SuspendWorkspaceHubRequest): Promise<WorkspaceHubRow> {
    await this.inbox.suspend(uuid, body);
    return this.one(uuid);
  }

  async unsuspend(uuid: string): Promise<WorkspaceHubRow> {
    await this.inbox.unsuspend(uuid);
    return this.one(uuid);
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async loadRow(uuid: string, now = new Date()) {
    const query = await this.queryContext();
    return this.store.tx(async (tx) => {
      const row = await this.repo.one(tx, uuid, query.sql);
      if (!row) throw AppError.notFound('Workspace', uuid);
      const orgId = Number(row.id);
      const midnight = new Date(daySpine(now, 30)[0]! + 'T00:00:00.000Z');
      const [facts, registry, freeLimits, fx, extras] = await Promise.all([
        this.repo.pageFacts(tx, [orgId], now),
        this.providers.all(tx),
        this.repo.freePlanLimits(tx),
        this.fx(tx),
        this.repo.detailExtras(tx, orgId, midnight),
      ]);
      const ctx = this.rowContext(
        now,
        fx,
        query.sql.fallbackProviderKey,
        query.fallbackSource,
        registry,
        freeLimits,
      );
      return { row: row as HubRawRow, ctx, facts, extras };
    });
  }

  private rowContext(
    now: Date,
    fx: Fx,
    fallbackKey: string,
    fallbackSource: 'default' | 'platform_setting',
    registry: ReadonlyArray<{ key: string; label: string }>,
    freeLimits: unknown,
  ): HubContext {
    return {
      now,
      fx,
      freeLimits,
      provider: {
        fallbackKey,
        fallbackSource,
        labels: new Map([
          ...Object.entries(BUILTIN_LABELS),
          ...registry.map((p) => [p.key, p.label] as const),
        ]),
      },
    };
  }

  /** Everything the SQL needs that is not in the database: wallet currency and thresholds, grace days, the fallback provider. */
  private async queryContext() {
    const s = await this.wallet.effective();
    const grace = await this.entitlements.graceDays();
    const { thresholds, fallback } = await this.store.tx(async (tx) => {
      const billableCurrencies = await this.billing.billable(tx);
      const limits = await Promise.all(
        billableCurrencies.map(
          async (c) => [c, await this.billing.fromPlatform(s.lowBalanceThresholdMinor, c)] as const,
        ),
      );
      const registryDefault = await this.providers.defaultActive(tx);
      return { thresholds: new Map(limits), fallback: registryDefault };
    });
    // The same three-step choice a new number follows, minus the override (each row carries its own).
    const choice = chooseNewNumberProvider({
      override: null,
      registryDefault: fallback ? { key: fallback.key } : null,
      platformSetting: this.env.WABA_DEFAULT_PROVIDER,
    });
    return {
      sql: {
        platformCurrency: s.currency,
        thresholds,
        graceDays: grace,
        fallbackProviderKey: choice.key,
      } satisfies HubQueryContext,
      fallbackSource:
        choice.source === 'default' ? ('default' as const) : ('platform_setting' as const),
    };
  }

  private async fx(tx: Tx): Promise<Fx> {
    const setting = await this.settings.get<unknown>('default_currency');
    const base = typeof setting === 'string' && /^[A-Z]{3}$/.test(setting) ? setting : 'USD';
    return new Fx(base, await this.repo.currencyRates(tx));
  }
}
