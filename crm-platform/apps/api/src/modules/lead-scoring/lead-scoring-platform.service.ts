import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  type LscPlatformOverview,
  type LscPlatformRun,
  type LscPlatformRunsQuery,
  type LscPlatformRunsResponse,
  type LscPlatformWorkspace,
  type LscPlatformWorkspacesQuery,
  type LscPlatformWorkspacesResponse,
  type UpdateLscPlatformConfigInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { AiKeyResolver } from '../ai-keys-usage-admin';
import {
  LSC_CONFIG_KEY,
  LeadScoringConfigService,
  type LscConfigDoc,
} from './lead-scoring-config.service';
import { toRun } from './lead-scoring.repository';
import { decodeRunCursor, encodeRunCursor, usdString } from './lead-scoring.rules';
import { lscTotalsOf } from './lead-scoring.service';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);

/** The platform operator's control of AI lead scoring: the switch, the model, the limits, and what it cost across every workspace. */
@Injectable()
export class LeadScoringPlatformService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: LeadScoringConfigService,
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly keys: AiKeyResolver,
  ) {}

  async overview(): Promise<LscPlatformOverview> {
    this.store.invalidate();
    const config = await this.config.get();
    const stats = await this.db.privileged(async (tx) => {
      const r = (
        await tx.execute(sql`
          SELECT (SELECT count(*) FROM lead_scoring_settings WHERE enabled) AS workspaces_enabled,
                 (SELECT count(*) FROM contacts WHERE lead_score_source = 'ai') AS contacts_scored`)
      ).rows[0] as Raw;
      const totals = async (since: 'day' | 'month') => {
        const interval = since === 'day' ? sql`interval '24 hours'` : sql`interval '30 days'`;
        const res = await tx.execute(sql`
          SELECT count(*) FILTER (WHERE status = 'ok') AS scores,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 COALESCE(sum(prompt_tokens), 0) AS prompt_tokens,
                 COALESCE(sum(completion_tokens), 0) AS completion_tokens,
                 COALESCE(sum(cost_usd), 0) AS cost_usd,
                 COALESCE(sum(cost_usd) FILTER (WHERE billed_against = 'admin'), 0) AS platform_cost_usd
            FROM lead_scoring_runs WHERE created_at >= now() - ${interval}`);
        return lscTotalsOf(res.rows[0] as Raw);
      };
      return {
        workspacesEnabled: num(r.workspaces_enabled),
        contactsScored: num(r.contacts_scored),
        last24h: await totals('day'),
        last30d: await totals('month'),
      };
    });
    const platformKey = await this.keys.resolve(null, 'openrouter');
    return { config, platformKeyReady: platformKey.key !== null, ...stats };
  }

  async workspaces(q: LscPlatformWorkspacesQuery): Promise<LscPlatformWorkspacesResponse> {
    const like = q.search ? `%${q.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid, o.name, COALESCE(s.enabled, false) AS enabled,
          (SELECT count(*) FROM contacts c WHERE c.org_id = o.id AND c.lead_score_source = 'ai') AS contacts_scored,
          (SELECT count(*) FROM lead_scoring_runs r WHERE r.org_id = o.id AND r.status = 'ok'
             AND r.created_at >= now() - interval '30 days') AS scores,
          (SELECT COALESCE(sum(r.cost_usd), 0) FROM lead_scoring_runs r WHERE r.org_id = o.id
             AND r.created_at >= now() - interval '30 days') AS cost
        FROM organizations o LEFT JOIN lead_scoring_settings s ON s.org_id = o.id
        WHERE (${like}::text IS NULL OR o.name ILIKE ${like})
        ORDER BY COALESCE(s.enabled, false) DESC,
                 (SELECT COALESCE(sum(r.cost_usd), 0) FROM lead_scoring_runs r WHERE r.org_id = o.id
                    AND r.created_at >= now() - interval '30 days') DESC, o.id
        LIMIT ${q.limit}`);
      return res.rows as Raw[];
    });
    const data: LscPlatformWorkspace[] = rows.map((r) => ({
      workspaceId: r.uuid as string,
      name: r.name as string,
      enabled: r.enabled as boolean,
      contactsScored: num(r.contacts_scored),
      scores30d: num(r.scores),
      costUsd30d: usdString(num(r.cost)),
    }));
    return { data };
  }

  /** The cost log across workspaces, newest first: what each score cost and who paid. */
  async runs(q: LscPlatformRunsQuery): Promise<LscPlatformRunsResponse> {
    const cur = q.cursor ? decodeRunCursor(q.cursor) : null;
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.*, c.uuid AS contact_uuid, o.uuid AS org_uuid, o.name AS org_name
          FROM lead_scoring_runs r
          JOIN organizations o ON o.id = r.org_id
          LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
         WHERE true
           ${q.workspaceId ? sql`AND o.uuid = ${q.workspaceId}::uuid` : sql``}
           ${q.status ? sql`AND r.status = ${q.status}` : sql``}
           ${cur ? sql`AND (r.created_at, r.id) < (${cur.at.toISOString()}::timestamptz, ${cur.id})` : sql``}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${q.limit + 1}`);
      return res.rows as Raw[];
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const hasMore = rows.length > q.limit;
    const data: LscPlatformRun[] = page.map((r) => ({
      ...toRun(r),
      workspaceId: r.org_uuid as string,
      workspaceName: r.org_name as string,
    }));
    return {
      data,
      page: {
        nextCursor:
          hasMore && last ? encodeRunCursor(new Date(String(last.created_at)), num(last.id)) : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  async update(input: UpdateLscPlatformConfigInput): Promise<LscPlatformOverview> {
    const operatorId = RequestContextStore.require().actorId;
    const before = await this.config.get();
    await this.store.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${LSC_CONFIG_KEY} FOR UPDATE`,
      );
      const current = ((found.rows[0] as { value: LscConfigDoc } | undefined)?.value ??
        {}) as LscConfigDoc;
      const next: LscConfigDoc = {
        ...current,
        ...input,
        _rv: (current._rv ?? 0) + 1,
        _at: new Date().toISOString(),
      };
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${LSC_CONFIG_KEY}, ${JSON.stringify(next)}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = false,
          updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record(tx, {
        event: 'platform.lead_scoring_config_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          fields: Object.keys(input),
          ...(input.platformEnabled !== undefined &&
          input.platformEnabled !== before.platformEnabled
            ? { platformEnabled: { from: before.platformEnabled, to: input.platformEnabled } }
            : {}),
          ...(input.model && input.model !== before.model
            ? { model: { from: before.model, to: input.model } }
            : {}),
        },
      });
    });
    return this.overview();
  }
}
