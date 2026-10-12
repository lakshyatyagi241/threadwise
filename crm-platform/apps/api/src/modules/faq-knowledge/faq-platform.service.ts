import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FAQ_EMBEDDING_MODELS,
  type FaqPlatformOverview,
  type FaqPlatformReindexInput,
  type FaqPlatformReindexResult,
  type FaqPlatformWorkspace,
  type FaqPlatformWorkspacesQuery,
  type FaqPlatformWorkspacesResponse,
  type UpdateFaqPlatformConfigInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { AiKeyResolver } from '../ai-keys-usage-admin';
import { FAQ_CONFIG_KEY, FaqConfigService, type FaqConfigDoc } from './faq-config.service';
import { FaqRepository } from './faq.repository';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);

/** The platform operator's control of the FAQ engine: the switch, the model, the limits, the health numbers and re-indexing. */
@Injectable()
export class FaqPlatformService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: FaqConfigService,
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly repo: FaqRepository,
    private readonly keys: AiKeyResolver,
  ) {}

  async overview(): Promise<FaqPlatformOverview> {
    this.store.invalidate();
    const config = await this.config.get();
    const model = config.embeddingModel;
    const ids = FAQ_EMBEDDING_MODELS.map((m) => m.id);
    const stats = await this.db.privileged(async (tx) => {
      const r = (
        await tx.execute(sql`
          SELECT
            (SELECT count(*) FROM faq_settings WHERE enabled) AS workspaces_enabled,
            (SELECT count(*) FROM faqs) AS faqs,
            (SELECT count(*) FROM faq_variations) AS variations,
            (SELECT count(*) FROM faq_variations WHERE embed_state = 'ready' AND embedding_model = ${model}) AS ready,
            (SELECT count(*) FROM faq_variations WHERE embed_state = 'pending') AS pending,
            (SELECT count(*) FROM faq_variations WHERE embed_state = 'failed') AS failed,
            (SELECT count(*) FROM faq_variations WHERE embed_state = 'ready' AND embedding_model IS DISTINCT FROM ${model}) AS stale,
            (SELECT count(*) FROM faq_match_logs WHERE origin = 'inbound' AND created_at >= now() - interval '30 days') AS matches,
            (SELECT count(*) FROM faq_match_logs WHERE origin = 'inbound' AND outcome IN ('answered', 'flow_started')
               AND created_at >= now() - interval '30 days') AS answered,
            (SELECT count(*) FROM faq_match_logs WHERE verify_verdict IN ('confirmed', 'rejected')
               AND created_at >= now() - interval '30 days') AS verified,
            (SELECT count(*) FROM faq_match_logs WHERE verify_verdict = 'rejected'
               AND created_at >= now() - interval '30 days') AS vetoed,
            (SELECT COALESCE(sum(total_tokens), 0) FROM ai_token_usage WHERE provider = 'openrouter'
               AND model IN (${sql.join(
                 ids.map((i) => sql`${i}`),
                 sql`, `,
               )}) AND created_at >= now() - interval '30 days') AS tokens`)
      ).rows[0] as Raw;
      return {
        workspacesEnabled: num(r.workspaces_enabled),
        faqs: num(r.faqs),
        variations: num(r.variations),
        ready: num(r.ready),
        pending: num(r.pending),
        failed: num(r.failed),
        staleModel: num(r.stale),
        matches30d: num(r.matches),
        answered30d: num(r.answered),
        embeddingTokens30d: num(r.tokens),
        verified30d: num(r.verified),
        vetoed30d: num(r.vetoed),
      };
    });
    const platformKey = await this.keys.resolve(null, 'openrouter');
    return { config, platformKeyReady: platformKey.key !== null, stats };
  }

  async workspaces(q: FaqPlatformWorkspacesQuery): Promise<FaqPlatformWorkspacesResponse> {
    const like = q.search ? `%${q.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT o.uuid, o.name, COALESCE(s.enabled, false) AS enabled,
          (SELECT count(*) FROM faqs f WHERE f.org_id = o.id) AS faqs,
          (SELECT count(*) FROM faq_variations v WHERE v.org_id = o.id) AS variations,
          (SELECT count(*) FROM faq_variations v WHERE v.org_id = o.id AND v.embed_state = 'pending') AS pending,
          (SELECT count(*) FROM faq_variations v WHERE v.org_id = o.id AND v.embed_state = 'failed') AS failed,
          (SELECT count(*) FROM faq_match_logs l WHERE l.org_id = o.id AND l.origin = 'inbound'
             AND l.created_at >= now() - interval '30 days') AS matches,
          (SELECT count(*) FROM faq_match_logs l WHERE l.org_id = o.id AND l.origin = 'inbound'
             AND l.outcome IN ('answered', 'flow_started') AND l.created_at >= now() - interval '30 days') AS answered
        FROM organizations o LEFT JOIN faq_settings s ON s.org_id = o.id
        WHERE (${like}::text IS NULL OR o.name ILIKE ${like})
        ORDER BY COALESCE(s.enabled, false) DESC,
                 (SELECT count(*) FROM faq_variations v WHERE v.org_id = o.id) DESC, o.id
        LIMIT ${q.limit}`);
      return res.rows as Raw[];
    });
    const data: FaqPlatformWorkspace[] = rows.map((r) => ({
      workspaceId: r.uuid as string,
      name: r.name as string,
      enabled: r.enabled as boolean,
      faqs: num(r.faqs),
      variations: num(r.variations),
      pending: num(r.pending),
      failed: num(r.failed),
      matches30d: num(r.matches),
      answered30d: num(r.answered),
    }));
    return { data };
  }

  async update(input: UpdateFaqPlatformConfigInput): Promise<FaqPlatformOverview> {
    const operatorId = RequestContextStore.require().actorId;
    const before = await this.config.get();
    await this.store.inTx(async (tx) => {
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${FAQ_CONFIG_KEY} FOR UPDATE`,
      );
      const current = ((found.rows[0] as { value: FaqConfigDoc } | undefined)?.value ??
        {}) as FaqConfigDoc;
      const { defaultThreshold, ...rest } = input;
      const next: FaqConfigDoc = {
        ...current,
        ...rest,
        _rv: (current._rv ?? 0) + 1,
        _at: new Date().toISOString(),
      };
      // A number fixes the default; `null` hands it back to the model; and changing the model without naming a number drops a number the
      // operator fixed for the old one (it was right for that model's scale, not for the new one).
      if (typeof defaultThreshold === 'number') next.defaultThreshold = defaultThreshold;
      else if (
        defaultThreshold === null ||
        (input.embeddingModel && input.embeddingModel !== before.embeddingModel)
      ) {
        delete next.defaultThreshold;
      }
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${FAQ_CONFIG_KEY}, ${JSON.stringify(next)}::jsonb, false, ${operatorId}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_secret = false,
          updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record(tx, {
        event: 'platform.faq_config_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          fields: Object.keys(input),
          ...(input.embeddingModel && input.embeddingModel !== before.embeddingModel
            ? { embeddingModel: { from: before.embeddingModel, to: input.embeddingModel } }
            : {}),
        },
      });
    });
    // A different model makes every stored vector useless for matching until it is re-made: queue them.
    if (input.embeddingModel && input.embeddingModel !== before.embeddingModel) {
      await this.db.privileged((tx) => this.repo.markStale(tx, input.embeddingModel!));
    }
    return this.overview();
  }

  async reindex(input: FaqPlatformReindexInput): Promise<FaqPlatformReindexResult> {
    const operatorId = RequestContextStore.require().actorId;
    const queued = await this.db.privileged(async (tx) => {
      const n =
        input.scope === 'failed'
          ? await this.repo.retryFailed(tx, null)
          : await this.repo.markAllPending(tx);
      await this.audit.record(tx, {
        event: 'platform.faq_reindex',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { scope: input.scope, queued: n },
      });
      return n;
    });
    return { queued };
  }
}
