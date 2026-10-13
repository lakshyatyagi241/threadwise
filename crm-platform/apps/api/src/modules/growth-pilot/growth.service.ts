import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  GROWTH_FEATURES,
  type GrowthAudience,
  type GrowthAudienceKind,
  type GrowthAudiencesResponse,
  type GrowthAutoStageResponse,
  type GrowthCampaignReport,
  type GrowthDailyDigest,
  type GrowthEnrichmentStatus,
  type GrowthFeature,
  type GrowthOverview,
  type GrowthPropensityModel,
  type GrowthQuality,
  type GrowthSendTimes,
  type GrowthSettings,
  type GrowthStampResult,
  type SyncAudienceResult,
  type UpdateGrowthSettingsInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  EnrichmentError,
  GROWTH_ENRICHMENT_PORT,
  type GrowthEnrichmentPort,
} from '../../infra/providers/growth-enrichment/growth-enrichment.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { CampaignsRepository } from '../campaigns';
import { ContactGroupsService, ContactsService } from '../crm';
import { auc } from './growth.rules';
import { GrowthGateService, type GrowthContext } from './growth-gate.service';
import { GrowthRepository } from './growth.repository';
import {
  applyConfigPatch,
  buildPropensity,
  digestHighlights,
  safeTimezone,
  sendTimeProfile,
  serviceRuleGroupName,
  serviceRuleKey,
} from './growth.rules';

const SETTINGS_MODULE = 'growth_settings';
const CAMPAIGN_WINDOW_DAYS = 90;

interface AudienceDef {
  key: string;
  kind: GrowthAudienceKind;
  feature: GrowthFeature;
  groupName: string;
}

const STATIC_AUDIENCES: ReadonlyArray<Omit<AudienceDef, 'key'>> = [
  { kind: 'engaged', feature: 'engagement_audiences', groupName: 'AI · Engaged' },
  { kind: 'silent', feature: 'engagement_audiences', groupName: 'AI · Silent' },
  { kind: 'lapsed', feature: 'engagement_audiences', groupName: 'AI · Lapsed customers' },
  { kind: 'hot_chat', feature: 'engagement_audiences', groupName: 'AI · Hot in chat' },
  { kind: 'high_propensity', feature: 'propensity', groupName: 'AI · Likely to convert' },
];

/**
 * The read side and the on-demand work of the growth pilot: settings, the replies campaigns really got, the audiences, the best send
 * hours, the conversion model, quality, the daily digest, the guarded automatic stage changes and enrichment. Every method begins at
 * `GrowthGateService`, so a workspace outside the pilot is refused (routes) or skipped (workers) before anything is read.
 */
@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GrowthRepository,
    private readonly gate: GrowthGateService,
    private readonly audit: AuditService,
    private readonly groups: ContactGroupsService,
    private readonly contacts: ContactsService,
    private readonly campaigns: CampaignsRepository,
    @Inject(GROWTH_ENRICHMENT_PORT) private readonly enrichment: GrowthEnrichmentPort,
  ) {}

  // --- settings -----------------------------------------------------------------------------------------------------

  async settings(orgId: number): Promise<GrowthSettings> {
    const ctx = await this.gate.load(orgId);
    return this.toSettings(ctx);
  }

  private toSettings(ctx: GrowthContext): GrowthSettings {
    return {
      available: ctx.available,
      features: ctx.features,
      config: ctx.config,
      rowVersion: ctx.rowVersion,
      enrichmentConfigured: this.enrichment.configured(),
    };
  }

  async updateSettings(orgId: number, input: UpdateGrowthSettingsInput): Promise<GrowthSettings> {
    const ctx = await this.gate.require(orgId);
    if (input.rowVersion === undefined || input.rowVersion !== ctx.rowVersion) {
      throw AppError.rowVersionConflict('Growth settings');
    }
    const features = { ...ctx.features, ...(input.features ?? {}) };
    const config = applyConfigPatch(ctx.storedConfig, input.config ?? {});
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const ok = await this.repo.saveSettings(tx, orgId, features, config, input.rowVersion);
      if (!ok) throw AppError.rowVersionConflict('Growth settings');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const f of GROWTH_FEATURES) {
        if (ctx.features[f] !== features[f]) delta[f] = { old: ctx.features[f], new: features[f] };
      }
      if (input.config) delta.config = { old: null, new: Object.keys(input.config).join(',') };
      await this.audit.record(tx, {
        module: SETTINGS_MODULE,
        recordId: orgId,
        action: 'update',
        delta: Object.keys(delta).length ? delta : undefined,
      });
    });
    return this.settings(orgId);
  }

  async overview(orgId: number): Promise<GrowthOverview> {
    const ctx = await this.gate.require(orgId);
    const stored = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.latestDigest(tx, orgId),
    );
    let digest = stored as GrowthDailyDigest | null;
    if (!digest && ctx.features.daily_digest) digest = await this.buildDigest(orgId);
    return { settings: this.toSettings(ctx), digest };
  }

  // --- campaigns: the replies that really happened ---------------------------------------------------------------------

  async campaignReport(orgId: number): Promise<GrowthCampaignReport> {
    await this.gate.require(orgId, 'campaign_response');
    const data = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.campaignReport(tx, orgId, CAMPAIGN_WINDOW_DAYS),
    );
    const sum = (f: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + f(r), 0);
    return {
      data,
      totals: {
        sent: sum((r) => r.sent),
        read: sum((r) => r.read),
        replied24h: sum((r) => r.replied24h),
        replied72h: sum((r) => r.replied72h),
        recordedResponses: sum((r) => r.recordedResponses),
      },
    };
  }

  /** Gives every recipient that wrote after a send a response time, then recounts the campaigns it touched. */
  async stampResponses(orgId: number): Promise<GrowthStampResult> {
    await this.gate.require(orgId, 'campaign_response');
    return this.stampResponsesIn(orgId);
  }

  /** The worker's entry: the caller already checked the gate. */
  async stampResponsesIn(orgId: number): Promise<GrowthStampResult> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const { stamped, campaignIds } = await this.repo.stampResponses(
        tx,
        orgId,
        CAMPAIGN_WINDOW_DAYS,
      );
      for (const id of campaignIds) await this.campaigns.recount(tx, orgId, id);
      return { stamped, campaignsRecounted: campaignIds.length };
    });
  }

  // --- audiences -----------------------------------------------------------------------------------------------------------

  private audienceDefs(ctx: GrowthContext): Array<AudienceDef & { index?: number }> {
    const defs: Array<AudienceDef & { index?: number }> = STATIC_AUDIENCES.filter(
      (d) => ctx.features[d.feature],
    ).map((d) => ({ ...d, key: d.kind }));
    if (ctx.features.service_rules) {
      ctx.config.serviceRules.forEach((rule, index) =>
        defs.push({
          key: serviceRuleKey(index),
          kind: 'service_due',
          feature: 'service_rules',
          groupName: serviceRuleGroupName(rule),
          index,
        }),
      );
    }
    return defs;
  }

  private async audienceIds(
    orgId: number,
    ctx: GrowthContext,
    def: AudienceDef & { index?: number },
  ): Promise<number[]> {
    return this.db.txAs({ orgId, userId: null }, (tx) => {
      switch (def.kind) {
        case 'engaged':
          return this.repo.engagedIds(tx, orgId, ctx.config.engagedOpens);
        case 'silent':
          return this.repo.silentIds(tx, orgId);
        case 'lapsed':
          return this.repo.lapsedIds(tx, orgId, ctx.config.lapsedDays);
        case 'hot_chat':
          return this.repo.hotChatIds(tx, orgId);
        case 'high_propensity':
          return this.repo.highPropensityIds(tx, orgId);
        case 'service_due':
          return this.repo.serviceDueIds(tx, orgId, ctx.config.serviceRules[def.index ?? 0]!);
      }
    });
  }

  async audiences(orgId: number): Promise<GrowthAudiencesResponse> {
    const ctx = await this.gate.require(orgId);
    const out: GrowthAudience[] = [];
    for (const def of this.audienceDefs(ctx)) {
      const ids = await this.audienceIds(orgId, ctx, def);
      const group = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
        g: await this.repo.groupByName(tx, orgId, def.groupName),
        at: await this.repo.groupSyncedAt(tx, orgId, def.groupName),
      }));
      out.push({
        key: def.key,
        kind: def.kind,
        label:
          def.kind === 'service_due' ? ctx.config.serviceRules[def.index ?? 0]!.label : def.kind,
        description: def.kind,
        count: ids.length,
        groupId: group.g?.uuid ?? null,
        groupName: def.groupName,
        syncedAt: group.g && group.at ? group.at.toISOString() : null,
      });
    }
    return { data: out };
  }

  /** Rebuilds the contact group of one audience so a campaign can use it. Creates the group the first time. */
  async syncAudience(orgId: number, key: string): Promise<SyncAudienceResult> {
    const ctx = await this.gate.require(orgId);
    const def = this.audienceDefs(ctx).find((d) => d.key === key);
    if (!def) throw AppError.notFound('Audience', key);
    return this.syncAudienceIn(orgId, ctx, def);
  }

  async syncAudienceIn(
    orgId: number,
    ctx: GrowthContext,
    def: AudienceDef & { index?: number },
  ): Promise<SyncAudienceResult> {
    const ids = await this.audienceIds(orgId, ctx, def);
    const r = await this.groups.syncSystemGroup(
      orgId,
      def.groupName,
      ids,
      'Kept up to date by the growth pilot.',
    );
    return {
      key: def.key,
      groupId: r.groupUuid,
      groupName: r.groupName,
      members: r.members,
      added: r.added,
      removed: r.removed,
    };
  }

  /** The worker's daily rebuild of every audience that has a group already (nobody is surprised by a group that appears). */
  async syncExistingAudiences(orgId: number): Promise<number> {
    const ctx = await this.gate.ifOn(orgId, 'engagement_audiences');
    if (!ctx) return 0;
    let n = 0;
    for (const def of this.audienceDefs(ctx)) {
      const exists = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.groupByName(tx, orgId, def.groupName),
      );
      if (!exists) continue;
      await this.syncAudienceIn(orgId, ctx, def);
      n += 1;
    }
    return n;
  }

  // --- send times ----------------------------------------------------------------------------------------------------------

  async sendTimes(orgId: number): Promise<GrowthSendTimes> {
    await this.gate.require(orgId, 'send_times');
    return this.sendTimesIn(orgId);
  }

  async sendTimesIn(orgId: number): Promise<GrowthSendTimes> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const tz = safeTimezone(await this.repo.timezone(tx, orgId));
      const h = await this.repo.hourHistograms(tx, orgId, tz);
      return sendTimeProfile(h.inbound, h.read, tz);
    });
  }

  // --- the conversion model ------------------------------------------------------------------------------------------------

  async propensityModel(orgId: number): Promise<GrowthPropensityModel> {
    await this.gate.require(orgId, 'propensity');
    const stored = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.getModel(tx, orgId, 'propensity'),
    );
    const summary = (stored as { summary?: GrowthPropensityModel } | null)?.summary;
    return (
      summary ?? {
        trained: false,
        positives: 0,
        contacts: 0,
        auc: null,
        topDecileCapture: null,
        computedAt: null,
        weights: [],
      }
    );
  }

  /** Learns from the workspace's converted contacts and scores every contact. */
  async recomputePropensity(orgId: number): Promise<GrowthPropensityModel> {
    await this.gate.require(orgId, 'propensity');
    return this.recomputePropensityIn(orgId);
  }

  async recomputePropensityIn(orgId: number): Promise<GrowthPropensityModel> {
    const rows = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.propensityRows(tx, orgId),
    );
    const built = buildPropensity(rows, new Date());
    const names = ['opens', 'received', 'messages', 'clicks', 'groups', 'email', 'chat', 'age'];
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.repo.savePropensity(
        tx,
        orgId,
        built.scores.map((s) => ({
          contactId: s.contactId,
          score: s.score,
          features: Object.fromEntries(names.map((n, i) => [n, Math.round(s.raw[i]! * 10) / 10])),
        })),
      );
      await this.repo.saveModel(tx, orgId, 'propensity', {
        summary: built.summary,
        model: built.model,
      });
    });
    return built.summary;
  }

  async contactGrowth(orgId: number, contactUuid: string) {
    const ctx = await this.gate.require(orgId);
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const [p, e] = await Promise.all([
        ctx.features.propensity ? this.repo.propensityOf(tx, orgId, contactUuid) : null,
        ctx.features.enrichment ? this.repo.enrichmentOf(tx, orgId, contactUuid) : null,
      ]);
      return {
        propensity: p
          ? { score: p.score, features: p.features, computedAt: p.computedAt.toISOString() }
          : null,
        enrichment:
          e && e.status === 'found'
            ? { status: e.status, data: e.data, fetchedAt: e.fetchedAt.toISOString() }
            : null,
      };
    });
  }

  // --- quality -------------------------------------------------------------------------------------------------------------

  async quality(orgId: number): Promise<GrowthQuality> {
    await this.gate.require(orgId, 'quality');
    const days = 30;
    const { sug, act, outcomes, cost } = await this.db.txAs(
      { orgId, userId: null },
      async (tx) => ({
        sug: await this.repo.suggestionStats(tx, orgId, days),
        act: await this.repo.actionStats(tx, orgId, days),
        outcomes: await this.repo.scoreOutcomes(tx, orgId),
        cost: await this.repo.costStats(tx, orgId, days),
      }),
    );
    const bucket = () => ({ accepted: 0, dismissed: 0, pending: 0, expired: 0 });
    const out: GrowthQuality['suggestions'] = {
      chat: bucket(),
      engagement: bucket(),
      autoApplied: 0,
      undone: 0,
    };
    for (const r of sug) {
      const n = Number(r.n);
      const src = r.source === 'engagement' ? out.engagement : out.chat;
      if (r.status === 'accepted') src.accepted += n;
      else if (r.status === 'dismissed') src.dismissed += n;
      else if (r.status === 'pending') src.pending += n;
      else if (r.status === 'expired' || r.status === 'superseded') src.expired += n;
      else if (r.status === 'auto_applied') out.autoApplied += n;
      else if (r.status === 'undone') out.undone += n;
    }
    const byType = new Map<string, { done: number; dismissed: number; open: number }>();
    for (const r of act) {
      const t = byType.get(String(r.type)) ?? { done: 0, dismissed: 0, open: 0 };
      const n = Number(r.n);
      if (r.status === 'done') t.done += n;
      else if (r.status === 'dismissed') t.dismissed += n;
      else if (r.status === 'open') t.open += n;
      byType.set(String(r.type), t);
    }
    const converted = outcomes.filter((o) => o.y === 1).length;
    return {
      windowDays: days,
      suggestions: out,
      actions: [...byType.entries()].map(([type, v]) => ({
        type: type as GrowthQuality['actions'][number]['type'],
        ...v,
      })),
      scoreAuc: auc(outcomes),
      scoredContacts: outcomes.length,
      convertedContacts: converted,
      cost: {
        calls: cost.calls,
        costUsd: cost.costUsd.toFixed(8),
        avgCostUsd: cost.calls > 0 ? (cost.costUsd / cost.calls).toFixed(8) : null,
      },
    };
  }

  // --- the daily digest -----------------------------------------------------------------------------------------------------

  async digest(orgId: number): Promise<GrowthDailyDigest> {
    await this.gate.require(orgId, 'daily_digest');
    return this.buildDigest(orgId);
  }

  async buildDigest(orgId: number): Promise<GrowthDailyDigest> {
    const f = await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.digestFacts(tx, orgId));
    const day = new Date().toISOString().slice(0, 10);
    const campaigns = { sent: Number(f.sent), read: Number(f.read), replied24h: Number(f.replied) };
    const base = {
      hotLeads: Number(f.hot),
      unanswered: Number(f.unanswered),
      optOuts: Number(f.optouts),
      suggestionsPending: Number(f.pending),
      lapsed: Number(f.lapsed),
      campaigns,
    };
    const digest: GrowthDailyDigest = {
      day,
      ...base,
      actionsOpen: Number(f.open_actions),
      newChats: Number(f.new_chats),
      topPropensity: Number(f.top_propensity),
      highlights: digestHighlights(base),
    };
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.saveDigest(tx, orgId, day, digest),
    );
    return digest;
  }

  // --- guarded automatic stage changes ----------------------------------------------------------------------------------------

  async autoStage(orgId: number): Promise<GrowthAutoStageResponse> {
    const ctx = await this.gate.require(orgId, 'auto_stage');
    const { log, stages, today } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      log: await this.repo.autoStageLog(tx, orgId, 50),
      stages: await this.repo.stages(tx, orgId),
      today: await this.repo.autoAppliedToday(tx, orgId),
    }));
    const label = (v: string) => stages.find((s) => s.value === v)?.label ?? v;
    return {
      data: log.map((r) => ({
        id: r.id,
        contactId: r.contactUuid,
        contactName: r.contactName,
        fromStageLabel: label(r.fromStage),
        toStageLabel: label(r.toStage),
        confidence: r.confidence,
        appliedAt: r.decidedAt.toISOString(),
        status: r.status,
      })),
      appliedToday: today,
      dailyCap: ctx.config.autoStage.dailyCap,
    };
  }

  /** Puts a contact back where it was before an automatic change, if nobody moved it since. */
  async undoAutoStage(orgId: number, suggestionUuid: string): Promise<void> {
    await this.gate.require(orgId, 'auto_stage');
    const s = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.suggestionForUndo(tx, orgId, suggestionUuid),
    );
    if (!s) throw AppError.notFound('Automatic stage change', suggestionUuid);
    const refuse = () =>
      new AppError(
        ERROR_CODES.GRW_UNDO_REFUSED,
        'This change cannot be undone any more: the contact moved on, or it was already undone.',
        HttpStatus.CONFLICT,
      );
    if (s.status !== 'auto_applied') throw refuse();
    const moved = await this.contacts.changeStageAsSystem(orgId, s.contactId, {
      expectFrom: s.toStage,
      to: s.fromStage,
    });
    if (!moved) throw refuse();
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.markSuggestion(tx, orgId, s.id, 'auto_applied', 'undone'),
    );
  }

  // --- enrichment ----------------------------------------------------------------------------------------------------------

  async enrichmentStatus(orgId: number): Promise<GrowthEnrichmentStatus> {
    await this.gate.require(orgId, 'enrichment');
    const c = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.enrichmentCounts(tx, orgId),
    );
    return {
      configured: this.enrichment.configured(),
      provider: this.enrichment.configured() ? this.enrichment.provider : null,
      found: c.found,
      notFound: c.notFound,
      failed: c.failed,
    };
  }

  /** The button: the same, after the gate. */
  async enrich(orgId: number): Promise<number> {
    await this.gate.require(orgId, 'enrichment');
    return this.runEnrichment(orgId);
  }

  /** Looks up a batch of contacts with a business email. Inert without a configured provider. Returns how many were asked about. */
  async runEnrichment(orgId: number, limit = 50): Promise<number> {
    if (!this.enrichment.configured()) return 0;
    const batch = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.enrichmentCandidates(tx, orgId, limit),
    );
    let asked = 0;
    for (const c of batch) {
      let status: 'found' | 'not_found' | 'failed' = 'failed';
      let data: Record<string, unknown> = {};
      try {
        const r = await this.enrichment.lookup(c.email);
        status = r.status;
        data = r.data as Record<string, unknown>;
      } catch (err) {
        if (
          err instanceof EnrichmentError &&
          (err.kind === 'auth' || err.kind === 'rate_limited')
        ) {
          this.logger.warn({ orgId, kind: err.kind }, 'enrichment stopped');
          break;
        }
        this.logger.warn({ orgId, err }, 'enrichment lookup failed');
      }
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.saveEnrichment(tx, orgId, c.id, this.enrichment.provider, status, data),
      );
      asked += 1;
    }
    return asked;
  }
}
