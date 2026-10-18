import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type LscBackfillInput,
  type LscBackfillResult,
  type LscCostTotals,
  type LscRun,
  type LscRunsQuery,
  type LscRunsResponse,
  type LscRunTrigger,
  type LscScoreResult,
  type LscSettings,
  type LscStatus,
  type UpdateLscSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  LEAD_SCORING_AI_PORT,
  LeadScoringAiError,
  type LeadScoringAiPort,
} from '../../infra/providers/lead-scoring/lead-scoring-ai.port';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { AiChargeService } from '../wallet-message-billing';
import { LeadChatDigestRepository } from './lead-chat-digest.repository';
import { isChatDigestPilot } from './lead-chat-digest.rules';
import { LeadScoringConfigService } from './lead-scoring-config.service';
import { LeadScoringRepository, type RunWrite } from './lead-scoring.repository';
import {
  AI_PROVIDER,
  LEAD_SCORING_FEATURE,
  MAX_COMPLETION_TOKENS,
  parseScore,
  resolveCost,
  scoringPrompt,
  usdString,
} from './lead-scoring.rules';

const SETTINGS_MODULE_KEY = 'lead_scoring_settings';
const CONTACTS_MODULE_KEY = 'contacts';

/** The job a queue entry carries: ids only, the processor re-reads the contact. */
export interface LeadScoreJob {
  orgId: number;
  contactId: number;
  trigger: LscRunTrigger;
}

export type ScoreOutcome =
  | { status: 'scored'; result: Omit<LscScoreResult, 'contactId'> & { kept: boolean } }
  | { status: 'skipped'; reason: string };

/** How long a created or changed contact waits before it is scored: edits in a burst (an import, a form) become one call. */
const AUTO_DELAY_MS = 20_000;

const totalsOf = (r: Record<string, unknown>): LscCostTotals => {
  const scores = Number(r.scores);
  const cost = Number(r.cost_usd);
  return {
    scores,
    failed: Number(r.failed),
    promptTokens: Number(r.prompt_tokens),
    completionTokens: Number(r.completion_tokens),
    costUsd: usdString(cost),
    avgCostPerScoreUsd: scores > 0 ? usdString(cost / scores) : null,
    platformCostUsd: usdString(Number(r.platform_cost_usd)),
  };
};
export { totalsOf as lscTotalsOf };

/**
 * AI lead scoring (LSC). One entry point does the work (`score`): checks the two switches, picks the key, asks the model about the
 * ANONYMISED facts of the contact, writes the score only if a person has not typed one, and records what the call cost. The request
 * path never waits for the vendor: contact changes and the backfill queue a job, and only the Score button calls `score` inline.
 */
@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeadScoringRepository,
    private readonly chat: LeadChatDigestRepository,
    private readonly config: LeadScoringConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly audit: AuditService,
    private readonly wallet: AiChargeService,
    private readonly plans: PlanEntitlementService,
    @Inject(LEAD_SCORING_AI_PORT) private readonly ai: LeadScoringAiPort,
    @InjectQueue(QUEUES.LSC_SCORE) private readonly queue: Queue<LeadScoreJob>,
  ) {}

  // --- queueing -----------------------------------------------------------------------------------------------------

  /**
   * Queues a contact to be scored. The job id is per contact, so a contact changed ten times while it waits is scored once; a queued job
   * is removed when it completes (a retained one would block the next score for the same contact).
   */
  async enqueue(job: LeadScoreJob, delayMs = 0): Promise<void> {
    await this.queue.add('score', job, {
      jobId: `lsc-${job.orgId}-${job.contactId}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000, jitter: 0.5 },
      removeOnComplete: true,
      removeOnFail: { count: 1_000, age: 24 * 3600 },
    });
  }

  /** The outbox consumer's entry: queue a created or changed contact when the workspace asked for automatic scoring. */
  async enqueueIfAuto(
    orgId: number,
    contactId: number,
    trigger: 'created' | 'updated',
  ): Promise<void> {
    const cfg = await this.config.get();
    if (!cfg.platformEnabled) return;
    const row = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.getSettings(tx, orgId),
    );
    if (!row?.enabled || !row.autoScore) return;
    // The plan side comes after the cheap checks above: only a workspace that switched scoring on pays for the entitlement read.
    if (!(await this.plans.featureEnabled(orgId, LEAD_SCORING_FEATURE))) return;
    await this.enqueue({ orgId, contactId, trigger }, AUTO_DELAY_MS);
  }

  // --- scoring ------------------------------------------------------------------------------------------------------

  /**
   * Scores one contact. `manual` is the Score button: every reason it cannot run is an error the person sees. From the queue the same
   * reasons are an outcome (and, when it is a problem the workspace should know about, a `skipped` row in the log).
   * A vendor failure is logged and thrown; the queue retries the ones worth retrying.
   */
  async score(orgId: number, contactId: number, trigger: LscRunTrigger): Promise<ScoreOutcome> {
    const manual = trigger === 'manual';
    const cfg = await this.config.getFresh();
    if (!cfg.platformEnabled) {
      if (manual) {
        throw new AppError(
          ERROR_CODES.LSC_PLATFORM_DISABLED,
          'AI lead scoring is switched off for the whole platform right now.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return { status: 'skipped', reason: 'platform_off' };
    }
    const settings = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.getSettings(tx, orgId),
    );
    if (!settings?.enabled) {
      if (manual) {
        throw new AppError(
          ERROR_CODES.LSC_NOT_ENABLED,
          'Switch AI lead scoring on in Settings first. Contact details are sent to an AI provider, so it is off until you choose.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return { status: 'skipped', reason: 'not_enabled' };
    }
    // The workspace opted in, but the AI lead scoring app is not part of it (never bought, uninstalled, paused or killed): nothing is sent.
    if (!(await this.plans.featureEnabled(orgId, LEAD_SCORING_FEATURE))) {
      if (manual) await this.plans.assertFeature(orgId, LEAD_SCORING_FEATURE);
      return { status: 'skipped', reason: 'feature_off' };
    }

    const contact = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.contactForScoring(tx, orgId, contactId),
    );
    if (!contact) return { status: 'skipped', reason: 'contact_gone' };
    const base: Omit<RunWrite, 'status' | 'billedAgainst'> = {
      contactId,
      contactName: contact.name,
      trigger,
      score: null,
      previousScore: contact.leadScore,
      reasons: null,
      model: cfg.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      costSource: 'none',
      durationMs: null,
      error: null,
    };
    // A score a person typed is theirs: no call is made (no cost), whoever asks.
    if (contact.leadScore !== null && contact.leadScoreSource !== 'ai') {
      if (manual) {
        throw new AppError(
          ERROR_CODES.LSC_MANUAL_SCORE,
          'This contact has a score someone typed. Clear it first if you want the AI to score it.',
          HttpStatus.CONFLICT,
        );
      }
      return { status: 'skipped', reason: 'manual_score' };
    }

    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      return this.skip(
        orgId,
        base,
        manual,
        'no_key',
        ERROR_CODES.LSC_NO_KEY,
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
      );
    }
    const billedAgainst = resolved.source;
    if (billedAgainst === 'admin') {
      try {
        await this.meter.guard(orgId);
      } catch (err) {
        if (err instanceof AppError && !manual) {
          return this.skip(
            orgId,
            base,
            false,
            'token_allowance',
            ERROR_CODES.PLAN_LIMIT_REACHED,
            err.message,
            billedAgainst,
          );
        }
        throw err;
      }
      if (cfg.scoresPerHour > 0) {
        const used = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.platformRunsLastHour(tx, orgId),
        );
        if (used >= cfg.scoresPerHour) {
          return this.skip(
            orgId,
            base,
            manual,
            'hourly_limit',
            ERROR_CODES.PLAN_LIMIT_REACHED,
            `This workspace reached ${cfg.scoresPerHour} AI scores this hour. Try again later, or add your own OpenRouter key.`,
            billedAgainst,
          );
        }
      }
    }

    // The platform's key is paid for from the workspace wallet: an empty wallet means no call (no cost to the platform). A workspace
    // on its own key pays its vendor directly and is not charged here.
    if (billedAgainst === 'admin') {
      try {
        await this.wallet.assertCanAfford(orgId);
      } catch (err) {
        if (err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY && !manual) {
          return this.skip(
            orgId,
            base,
            false,
            'wallet_empty',
            ERROR_CODES.WALLET_EMPTY,
            err.message,
            billedAgainst,
          );
        }
        throw err;
      }
    }

    const prompt = scoringPrompt(contact.facts);
    const started = Date.now();
    let completion;
    try {
      completion = await this.ai.complete({
        apiKey: resolved.key,
        model: cfg.model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: await this.keys.capMaxTokens(AI_PROVIDER, MAX_COMPLETION_TOKENS),
      });
    } catch (err) {
      const ms = Date.now() - started;
      const kind = err instanceof LeadScoringAiError ? err.kind : 'provider';
      await this.logRun(orgId, {
        ...base,
        status: 'failed',
        billedAgainst,
        durationMs: ms,
        error: kind,
      });
      if (err instanceof LeadScoringAiError) {
        if (manual || !err.retryable) {
          throw new AppError(
            ERROR_CODES.LSC_PROVIDER_FAILED,
            err.kind === 'auth'
              ? 'The AI provider refused the saved key.'
              : 'The AI provider could not score this contact right now. Try again in a moment.',
            err.kind === 'auth' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
          );
        }
      }
      throw err;
    }

    const durationMs = Date.now() - started;
    const cost = resolveCost(
      completion.costUsd,
      cfg.model,
      completion.promptTokens,
      completion.completionTokens,
    );
    const spent = {
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      costUsd: cost.costUsd,
      costSource: cost.source,
      durationMs,
      billedAgainst,
    };
    const parsed = parseScore(completion.text);
    if (!parsed) {
      // The call was paid for and the answer is unusable: log it with its cost, write nothing, do not retry (a retry pays again).
      await this.logRun(orgId, { ...base, ...spent, status: 'failed', error: 'bad_response' });
      await this.recordTokens(orgId, cfg.model, spent, billedAgainst);
      await this.chargeWallet(orgId, contactId, spent.costUsd, billedAgainst);
      if (manual) {
        throw new AppError(
          ERROR_CODES.LSC_PROVIDER_FAILED,
          'The AI provider answered something that is not a score. Try again.',
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { status: 'skipped', reason: 'bad_response' };
    }

    const kept = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const written = await this.repo.writeScore(tx, orgId, contactId, {
        score: parsed.score,
        reasons: parsed.reasons,
        model: cfg.model,
      });
      await this.repo.insertRun(tx, orgId, {
        ...base,
        ...spent,
        status: written ? 'ok' : 'kept',
        score: parsed.score,
        reasons: parsed.reasons,
        previousScore: written ? written.previous : contact.leadScore,
      });
      await this.meter.record(
        orgId,
        {
          provider: AI_PROVIDER,
          model: cfg.model,
          promptTokens: spent.promptTokens,
          completionTokens: spent.completionTokens,
          billedAgainst,
        },
        tx,
      );
      if (billedAgainst === 'admin') {
        await this.wallet.charge(
          tx,
          { orgId, label: 'AI lead scoring', costUsd: spent.costUsd, source: 'ai.lead_scoring' },
          `ai-lsc:${orgId}:${contactId}:${randomUUID()}`,
        );
      }
      if (written) {
        await this.audit.record(tx, {
          module: CONTACTS_MODULE_KEY,
          recordId: contactId,
          action: 'update',
          delta: { leadScore: { old: written.previous, new: parsed.score } },
        });
      }
      return !written;
    });
    return {
      status: 'scored',
      result: {
        score: parsed.score,
        reasons: parsed.reasons,
        model: cfg.model,
        costUsd: usdString(cost.costUsd),
        promptTokens: spent.promptTokens,
        completionTokens: spent.completionTokens,
        kept,
      },
    };
  }

  /** The Score button. */
  async scoreNow(contactUuid: string): Promise<LscScoreResult> {
    const orgId = RequestContextStore.orgId();
    const contactId = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.contactByUuid(tx, orgId, contactUuid),
    );
    if (contactId === null) throw AppError.notFound('Contact', contactUuid);
    const out = await this.score(orgId, contactId, 'manual');
    if (out.status !== 'scored') throw AppError.notFound('Contact', contactUuid);
    if (out.result.kept) {
      throw new AppError(
        ERROR_CODES.LSC_MANUAL_SCORE,
        'Someone typed a score for this contact while it was being scored, so it was kept.',
        HttpStatus.CONFLICT,
      );
    }
    const { kept: _kept, ...rest } = out.result;
    return { contactId: contactUuid, ...rest };
  }

  // --- the workspace's screens ----------------------------------------------------------------------------------------

  async getSettings(): Promise<LscSettings> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    const { row, counts, totals, slug, pending } = await this.db.tx(async (tx) => ({
      row: await this.repo.getSettings(tx, orgId),
      counts: await this.repo.counts(tx, orgId),
      totals: await this.repo.totals(tx, orgId, 'month'),
      slug: await this.chat.orgSlug(tx, orgId),
      pending: await this.chat.pendingCount(tx, orgId),
    }));
    const key = await this.keys.resolve(orgId, AI_PROVIDER);
    return {
      enabled: row?.enabled ?? false,
      autoScore: row?.autoScore ?? true,
      chatDigest: row?.chatDigest ?? false,
      stageSuggestions: row?.stageSuggestions ?? false,
      stageAutoApply: row?.stageAutoApply ?? true,
      chatDigestAvailable: isChatDigestPilot(slug),
      pendingSuggestions: pending,
      platformEnabled: cfg.platformEnabled,
      model: cfg.model,
      keySource: key.key ? key.source : 'none',
      eligibleContacts: counts.eligible,
      scoredContacts: counts.scored,
      last30d: totalsOf(totals),
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  /** The workspace switch alone (no cost, model or counts), readable by anyone who reads contacts. */
  async getStatus(): Promise<LscStatus> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.getSettings(tx, orgId));
    return { enabled: row?.enabled ?? false };
  }

  async updateSettings(input: UpdateLscSettingsInput): Promise<LscSettings> {
    const orgId = RequestContextStore.orgId();
    await this.db.tx(async (tx) => {
      const before = await this.repo.getSettings(tx, orgId);
      if (before && input.rowVersion === undefined)
        throw AppError.rowVersionConflict('Lead scoring settings');
      if (!before && input.rowVersion !== undefined)
        throw AppError.rowVersionConflict('Lead scoring settings');
      const chatDigest = input.chatDigest ?? before?.chatDigest ?? false;
      const next = {
        enabled: input.enabled,
        autoScore: input.autoScore ?? before?.autoScore ?? true,
        chatDigest,
        // A stage is suggested from a reading of the chat, so it cannot be on without it.
        stageSuggestions:
          chatDigest && (input.stageSuggestions ?? before?.stageSuggestions ?? false),
        // Automatic is the default; the choice is kept while suggestions are off, so turning them back on remembers it.
        stageAutoApply: input.stageAutoApply ?? before?.stageAutoApply ?? true,
      };
      // Reading conversations sends masked chat text to the vendor, which is only offered to the pilot workspaces.
      const turningOn =
        (next.chatDigest && !before?.chatDigest) ||
        (next.stageSuggestions && !before?.stageSuggestions);
      if (turningOn && !isChatDigestPilot(await this.chat.orgSlug(tx, orgId))) {
        throw new AppError(
          ERROR_CODES.LSC_CHAT_DIGEST_UNAVAILABLE,
          'Reading conversations is not available to this workspace yet.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (!(await this.repo.saveSettings(tx, orgId, next, input.rowVersion))) {
        throw AppError.rowVersionConflict('Lead scoring settings');
      }
      const was = {
        enabled: before?.enabled ?? false,
        autoScore: before?.autoScore ?? true,
        chatDigest: before?.chatDigest ?? false,
        stageSuggestions: before?.stageSuggestions ?? false,
        stageAutoApply: before?.stageAutoApply ?? true,
      };
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const k of [
        'enabled',
        'autoScore',
        'chatDigest',
        'stageSuggestions',
        'stageAutoApply',
      ] as const) {
        if (was[k] !== next[k]) delta[k] = { old: was[k], new: next[k] };
      }
      await this.audit.record(tx, {
        module: SETTINGS_MODULE_KEY,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        delta: Object.keys(delta).length ? delta : undefined,
      });
    });
    return this.getSettings();
  }

  /** Queues the contacts that have no score yet (up to `limit`). Rows already scored, or scored by a person, are never queued. */
  async backfill(input: LscBackfillInput): Promise<LscBackfillResult> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    if (!cfg.platformEnabled) {
      throw new AppError(
        ERROR_CODES.LSC_PLATFORM_DISABLED,
        'AI lead scoring is switched off for the whole platform right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const settings = await this.db.tx((tx) => this.repo.getSettings(tx, orgId));
    if (!settings?.enabled) {
      throw new AppError(
        ERROR_CODES.LSC_NOT_ENABLED,
        'Switch AI lead scoring on in Settings first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const key = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!key.key || key.source === 'none') {
      throw new AppError(
        ERROR_CODES.LSC_NO_KEY,
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const ids = await this.db.tx((tx) => this.repo.unscoredIds(tx, orgId, input.limit));
    // Spread over time so a big workspace does not spend its hourly allowance in one burst.
    let i = 0;
    for (const contactId of ids)
      await this.enqueue({ orgId, contactId, trigger: 'backfill' }, (i++ % 600) * 400);
    this.logger.log({ orgId, queued: ids.length }, 'lead scoring backfill queued');
    return { queued: ids.length };
  }

  async listRuns(q: LscRunsQuery): Promise<LscRunsResponse> {
    const orgId = RequestContextStore.orgId();
    const { items, nextCursor, hasMore } = await this.db.tx((tx) =>
      this.repo.listRuns(tx, orgId, {
        contactUuid: q.contactId,
        status: q.status,
        cursor: q.cursor,
        limit: q.limit,
      }),
    );
    return { data: items as LscRun[], page: { nextCursor, hasMore, limit: q.limit } };
  }

  // --- internals ----------------------------------------------------------------------------------------------------

  /** A problem the workspace should see in the log (no key, allowance, hourly limit): from the queue a `skipped` row, from the button an error. */
  private async skip(
    orgId: number,
    base: Omit<RunWrite, 'status' | 'billedAgainst'>,
    manual: boolean,
    reason: string,
    code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
    message: string,
    billedAgainst: RunWrite['billedAgainst'] = 'none',
  ): Promise<ScoreOutcome> {
    if (manual) throw new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
    await this.logRun(orgId, { ...base, status: 'skipped', billedAgainst, error: reason });
    return { status: 'skipped', reason };
  }

  /** Charges a call that was paid for but produced no score (its own transaction). A failure is logged, never thrown. */
  private async chargeWallet(
    orgId: number,
    contactId: number,
    costUsd: number,
    billedAgainst: 'admin' | 'workspace',
  ): Promise<void> {
    if (billedAgainst !== 'admin') return;
    await this.db
      .txAs({ orgId, userId: null }, (tx) =>
        this.wallet.charge(
          tx,
          { orgId, label: 'AI lead scoring', costUsd, source: 'ai.lead_scoring' },
          `ai-lsc:${orgId}:${contactId}:${randomUUID()}`,
        ),
      )
      .catch((err) => this.logger.warn({ orgId, err }, 'lead scoring wallet charge failed'));
  }

  private async logRun(orgId: number, w: RunWrite): Promise<void> {
    await this.db
      .txAs({ orgId, userId: null }, (tx) => this.repo.insertRun(tx, orgId, w))
      .catch((err) => this.logger.warn({ orgId, err }, 'lead scoring run not logged'));
  }

  private async recordTokens(
    orgId: number,
    model: string,
    spent: { promptTokens: number; completionTokens: number },
    billedAgainst: 'admin' | 'workspace',
  ): Promise<void> {
    await this.meter
      .record(orgId, {
        provider: AI_PROVIDER,
        model,
        promptTokens: spent.promptTokens,
        completionTokens: spent.completionTokens,
        billedAgainst,
      })
      .catch((err) => this.logger.warn({ orgId, err }, 'lead scoring usage not recorded'));
  }
}
