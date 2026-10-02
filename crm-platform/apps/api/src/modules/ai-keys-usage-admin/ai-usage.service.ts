import { Injectable } from '@nestjs/common';
import {
  AI_USAGE_WINDOW_DAYS,
  type AiDashboardResponse,
  type AiUsageQuery,
  type AiUsageResponse,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformStore } from '../auth';
import { AiTokenMeter } from './ai-token-meter.service';
import { capView, estimateCostUsd, fillDaily, windowStart } from './ai-rules';
import { PLATFORM_KEY_COLUMNS, type PlatformKeyRow } from './platform-keys.service';
import { KeyVault } from './key-vault';
import { readLedger, readModels } from './usage-queries';

/**
 * The two AI usage screens over the one ledger.
 *
 * Workspace (TW-AIADM-025..027): this workspace's rows only, under its own row-level security, plus the monthly
 * platform-key cap. Platform (TW-AIADM-020..024): every workspace, so it runs through the platform door, and adds the
 * live state of the keys. Windows end today (UTC); days with no spend are zero so a chart has no gaps.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly platform: PlatformStore,
    private readonly meter: AiTokenMeter,
    private readonly vault: KeyVault,
  ) {}

  async forWorkspace(query: AiUsageQuery, now: Date = new Date()): Promise<AiUsageResponse> {
    const ctx = RequestContextStore.require();
    const from = windowStart(query.window, now);
    const days = AI_USAGE_WINDOW_DAYS[query.window];

    const { ledger, models } = await this.db.tx(async (tx) => ({
      ledger: await readLedger(tx, from, ctx.orgId),
      models: await readModels(tx, from, 15, ctx.orgId),
    }));
    const [used, limit] = await Promise.all([
      this.meter.usedThisMonth(ctx.orgId, now),
      this.meter.monthlyLimit(ctx.orgId),
    ]);

    return {
      window: query.window,
      from: from.toISOString(),
      kpis: {
        tokens: ledger.tokens,
        calls: ledger.calls,
        platformTokens: ledger.platformTokens,
        ownKeyTokens: ledger.ownKeyTokens,
        estimatedCostUsd: estimateCostUsd(ledger.byProvider),
        providers: ledger.providers,
        models: ledger.models,
      },
      daily: fillDaily(ledger.daily, from, days),
      byProvider: ledger.byProvider,
      byModel: models,
      sourceSplit: { admin: ledger.platformTokens, workspace: ledger.ownKeyTokens },
      cap: capView(used, limit),
    };
  }

  async forPlatform(query: AiUsageQuery, now: Date = new Date()): Promise<AiDashboardResponse> {
    const from = windowStart(query.window, now);
    const days = AI_USAGE_WINDOW_DAYS[query.window];

    const { ledger, models, top, keyRows, byok } = await this.platform.tx(async (tx) => {
      const topRes = await tx.execute(sql`
        SELECT o.uuid, o.name, sum(u.total_tokens)::bigint AS tokens, count(*)::bigint AS calls,
               COALESCE(sum(u.total_tokens) FILTER (WHERE u.billed_against = 'workspace'), 0)::bigint AS own_tokens
        FROM ai_token_usage u JOIN organizations o ON o.id = u.org_id
        WHERE u.created_at >= ${from}
        GROUP BY o.id, o.uuid, o.name ORDER BY tokens DESC, o.id LIMIT 12
      `);
      const keys = await tx.execute(
        sql`SELECT ${PLATFORM_KEY_COLUMNS} FROM admin_ai_keys ORDER BY provider`,
      );
      const byokRes = await tx.execute(sql`
        SELECT provider, count(*)::int AS n, count(DISTINCT org_id)::int AS workspaces
        FROM ai_provider_keys WHERE is_active GROUP BY provider
      `);
      const byokWorkspaces = await tx.execute(
        sql`SELECT count(DISTINCT org_id)::int AS n FROM ai_provider_keys WHERE is_active`,
      );
      return {
        ledger: await readLedger(tx, from),
        models: await readModels(tx, from, 10),
        top: topRes.rows as Array<Record<string, unknown>>,
        keyRows: keys.rows as unknown as PlatformKeyRow[],
        byok: {
          rows: byokRes.rows as Array<{ provider: string; n: number }>,
          workspaces: Number((byokWorkspaces.rows[0] as { n: number }).n),
        },
      };
    });

    return {
      window: query.window,
      from: from.toISOString(),
      kpis: {
        tokens: ledger.tokens,
        calls: ledger.calls,
        platformTokens: ledger.platformTokens,
        ownKeyTokens: ledger.ownKeyTokens,
        estimatedCostUsd: estimateCostUsd(ledger.byProvider),
        providers: ledger.providers,
        workspaces: ledger.workspaces,
      },
      daily: fillDaily(ledger.daily, from, days),
      byProvider: ledger.byProvider,
      byModel: models.map(({ model, provider, tokens, calls }) => ({
        model,
        provider,
        tokens,
        calls,
      })),
      topWorkspaces: top.map((r) => ({
        id: String(r.uuid),
        name: String(r.name),
        tokens: Number(r.tokens),
        calls: Number(r.calls),
        ownKeyTokens: Number(r.own_tokens),
      })),
      sourceSplit: { admin: ledger.platformTokens, workspace: ledger.ownKeyTokens },
      keys: {
        platform: keyRows.map((r) => ({
          provider: r.provider,
          defaultModel: r.default_model,
          live: r.is_active && this.vault.read(r.api_key, r.provider).state === 'readable',
        })),
        byok: {
          count: byok.rows.reduce((sum, r) => sum + Number(r.n), 0),
          workspaces: byok.workspaces,
          byProvider: Object.fromEntries(byok.rows.map((r) => [r.provider, Number(r.n)])),
        },
      },
    };
  }
}
