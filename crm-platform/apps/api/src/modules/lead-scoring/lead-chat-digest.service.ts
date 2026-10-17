import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  type LscInsight,
  type LscRunTrigger,
  type LscSuggestionDecisionInput,
  type LscSuggestionDecisionResult,
  type LscSuggestionsQuery,
  type LscSuggestionsResponse,
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
import { ContactsService } from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  LeadChatDigestRepository,
  toSuggestion,
  type DigestCandidate,
} from './lead-chat-digest.repository';
import { ChatDigestListeners, type ChatDigestEvent } from './lead-chat-digest.listeners';
import {
  CHAT_WINDOW_DAYS,
  DIGEST_MAX_COMPLETION_TOKENS,
  IDLE_MINUTES,
  RULES_MODEL,
  SUGGESTION_TTL_DAYS,
  digestPrompt,
  isChatDigestPilot,
  nameParts,
  parseDigest,
  planChat,
  prepareChat,
  signalsFromIntents,
  stageToSuggest,
  strongestIntent,
  suggestableStages,
  type StageOption,
} from './lead-chat-digest.rules';
import { LeadStageLineService } from './lead-stage-line.service';
import { LeadScoringConfigService } from './lead-scoring-config.service';
import { LeadScoringRepository, type RunWrite } from './lead-scoring.repository';
import { AI_PROVIDER, LEAD_SCORING_FEATURE, resolveCost } from './lead-scoring.rules';

const SUGGESTION_MODULE_KEY = 'lifecycle_stage_suggestions';
const CONTACTS_MODULE_KEY = 'contacts';

/** The job the idle sweeper queues: ids only, the processor re-reads everything. */
export interface LeadDigestJob {
  orgId: number;
  contactId: number;
  trigger: 'chat' | 'manual';
}

export type DigestOutcome =
  { status: 'digest'; source: 'ai' | 'rules' } | { status: 'skipped'; reason: string };

const SWEEP_BATCH = 200;

/**
 * Reading a contact's conversation for lead scoring (the "chat digest"): when the chat has gone quiet, the masked recent messages and
 * the anonymised facts go to the model in ONE call that answers with the intent, a score and, when the chat shows it, a lifecycle
 * stage. A person then accepts or dismisses the stage; nothing moves a contact by itself.
 *
 * What it will not do: read chat in a workspace outside the pilot list or one that has not switched it on; send a message it has
 * not masked; read a contact that only tapped buttons (the phrase table answers that for free); overwrite a score a person typed;
 * suggest a closing stage; or touch a contact whose stage moved in the last days.
 */
@Injectable()
export class LeadChatDigestService {
  private readonly logger = new Logger(LeadChatDigestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeadScoringRepository,
    private readonly chat: LeadChatDigestRepository,
    private readonly config: LeadScoringConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    private readonly listeners: ChatDigestListeners,
    private readonly stageLines: LeadStageLineService,
    private readonly plans: PlanEntitlementService,
    @Inject(LEAD_SCORING_AI_PORT) private readonly ai: LeadScoringAiPort,
    @InjectQueue(QUEUES.LSC_SCORE) private readonly queue: Queue<LeadDigestJob>,
  ) {}

  // --- queueing -----------------------------------------------------------------------------------------------------

  async enqueue(c: DigestCandidate): Promise<void> {
    await this.queue.add(
      'digest',
      { orgId: c.orgId, contactId: c.contactId, trigger: 'chat' },
      {
        jobId: `lscd-${c.orgId}-${c.contactId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: true,
        removeOnFail: { count: 1_000, age: 24 * 3600 },
      },
    );
  }

  /** The idle sweep: queue every contact whose chat went quiet since it was last read. Returns how many were queued. */
  async queueIdle(): Promise<number> {
    const cfg = await this.config.get();
    if (!cfg.platformEnabled) return 0;
    const found = await this.db.privileged((tx) =>
      this.chat.idleCandidates(tx, IDLE_MINUTES, CHAT_WINDOW_DAYS, SWEEP_BATCH),
    );
    for (const c of found) await this.enqueue(c);
    return found.length;
  }

  // --- reading one contact ------------------------------------------------------------------------------------------

  async digest(
    orgId: number,
    contactId: number,
    trigger: 'chat' | 'manual',
  ): Promise<DigestOutcome> {
    const manual = trigger === 'manual';
    const runTrigger: LscRunTrigger = manual ? 'manual' : 'chat';
    const stop = (
      code: keyof typeof ERROR_CODES,
      message: string,
      reason: string,
    ): DigestOutcome => {
      if (manual) throw new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);
      return { status: 'skipped', reason };
    };

    const cfg = await this.config.getFresh();
    if (!cfg.platformEnabled) {
      return stop(
        'LSC_PLATFORM_DISABLED',
        'AI lead scoring is switched off for the whole platform right now.',
        'platform_off',
      );
    }
    const gate = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      settings: await this.repo.getSettings(tx, orgId),
      slug: await this.chat.orgSlug(tx, orgId),
    }));
    if (!gate.settings?.enabled) {
      return stop(
        'LSC_NOT_ENABLED',
        'Switch AI lead scoring on in Settings first. Contact details are sent to an AI provider, so it is off until you choose.',
        'not_enabled',
      );
    }
    if (!(await this.plans.featureEnabled(orgId, LEAD_SCORING_FEATURE))) {
      return stop(
        'PLAN_FEATURE_LOCKED',
        'AI lead scoring is not part of your workspace. Install the AI lead scoring app from the Marketplace.',
        'feature_off',
      );
    }
    if (!isChatDigestPilot(gate.slug) || !gate.settings.chatDigest) {
      return stop(
        'LSC_CHAT_DIGEST_UNAVAILABLE',
        'Reading conversations is not switched on for this workspace.',
        'chat_digest_off',
      );
    }

    const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const brief = await this.chat.contactBrief(tx, orgId, contactId);
      if (!brief) return null;
      return {
        brief,
        messages: await this.chat.chatFor(tx, orgId, contactId),
        stages: await this.chat.stages(tx, orgId),
        lastThrough: await this.chat.lastThrough(tx, orgId, contactId),
        scoring: await this.repo.contactForScoring(tx, orgId, contactId),
        conversation: await this.chat.latestConversation(tx, orgId, contactId),
        growth: await this.chat.growthChatConfig(tx, orgId),
      };
    });
    if (!loaded?.scoring) return { status: 'skipped', reason: 'contact_gone' };
    const { brief, stages, scoring } = loaded;

    // The workspace's own words to mask and its own button taps (the growth pilot's settings; empty elsewhere).
    const mask = { names: [...nameParts(brief.name), ...loaded.growth.extraMaskTerms] };
    const prepared = prepareChat(loaded.messages, {
      ...mask,
      customPhrases: loaded.growth.customPhrases,
    });
    const announce = (e: Pick<ChatDigestEvent, 'digestId' | 'source'> & Partial<ChatDigestEvent>) =>
      this.listeners.emit({
        orgId,
        contactId,
        contactUuid: brief.uuid,
        contactName: brief.name,
        lifecycleStage: brief.lifecycleStage,
        conversation: loaded.conversation,
        trigger,
        intent: 'other',
        signals: { askedPrice: false, readyToBuy: false, objection: false, urgent: false },
        summary: null,
        score: null,
        reasons: [],
        suggestedStage: null,
        stageConfidence: null,
        language: null,
        issue: null,
        phraseIntents: prepared.phraseIntents,
        optOut: prepared.phraseIntents.includes('not_interested'),
        ...e,
      });
    const plan = planChat(prepared);
    if (plan === 'none' || prepared.throughAt === null) {
      return stop(
        'LSC_NOT_ENOUGH_CHAT',
        'This contact has not said enough yet: only greetings, emoji or automatic replies.',
        'not_enough_chat',
      );
    }
    if (!manual && loaded.lastThrough && prepared.throughAt <= loaded.lastThrough) {
      return { status: 'skipped', reason: 'already_read' };
    }

    // Button and keyword taps the phrase table understands: answered for free, no model, no cost.
    if (plan === 'rules') {
      const digestId = await this.db.txAs({ orgId, userId: null }, async (tx) => {
        return this.chat.insertDigest(tx, orgId, {
          contactId,
          throughAt: prepared.throughAt!,
          messagesRead: prepared.messagesRead,
          inboundRead: prepared.inboundRead,
          source: 'rules',
          intent: strongestIntent(prepared.phraseIntents),
          signals: signalsFromIntents(prepared.phraseIntents),
          summary: null,
          score: null,
          reasons: [],
          suggestedStage: null,
          stageConfidence: null,
          evidence: [],
          model: RULES_MODEL,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          costSource: 'none',
          billedAgainst: 'none',
          durationMs: null,
          trigger,
        });
      });
      await announce({
        digestId,
        source: 'rules',
        intent: strongestIntent(prepared.phraseIntents),
        signals: signalsFromIntents(prepared.phraseIntents),
      });
      return { status: 'digest', source: 'rules' };
    }

    const base: Omit<RunWrite, 'status' | 'billedAgainst'> = {
      contactId,
      contactName: brief.name,
      trigger: runTrigger,
      score: null,
      previousScore: scoring.leadScore,
      reasons: null,
      model: cfg.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      costSource: 'none',
      durationMs: null,
      error: null,
    };
    const skip = async (
      reason: string,
      code: keyof typeof ERROR_CODES,
      message: string,
      billedAgainst: RunWrite['billedAgainst'] = 'none',
    ): Promise<DigestOutcome> => {
      if (manual) throw new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);
      await this.logRun(orgId, { ...base, status: 'skipped', billedAgainst, error: reason });
      return { status: 'skipped', reason };
    };

    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      return skip(
        'no_key',
        'LSC_NO_KEY',
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
      );
    }
    const billedAgainst = resolved.source;
    if (billedAgainst === 'admin') {
      try {
        await this.meter.guard(orgId);
      } catch (err) {
        if (err instanceof AppError && !manual) {
          return skip('token_allowance', 'PLAN_LIMIT_REACHED', err.message, billedAgainst);
        }
        throw err;
      }
      if (cfg.scoresPerHour > 0) {
        const used = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.platformRunsLastHour(tx, orgId),
        );
        if (used >= cfg.scoresPerHour) {
          return skip(
            'hourly_limit',
            'PLAN_LIMIT_REACHED',
            `This workspace reached ${cfg.scoresPerHour} AI calls this hour. Try again later, or add your own OpenRouter key.`,
            billedAgainst,
          );
        }
      }
    }

    const allowed = suggestableStages(stages, brief.lifecycleStage);
    const prompt = digestPrompt({
      facts: scoring.facts,
      stages,
      currentStage: brief.lifecycleStage,
      chat: prepared,
    });
    const started = Date.now();
    let completion;
    try {
      completion = await this.ai.complete({
        apiKey: resolved.key,
        model: cfg.model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: await this.keys.capMaxTokens(AI_PROVIDER, DIGEST_MAX_COMPLETION_TOKENS),
      });
    } catch (err) {
      const kind = err instanceof LeadScoringAiError ? err.kind : 'provider';
      await this.logRun(orgId, {
        ...base,
        status: 'failed',
        billedAgainst,
        durationMs: Date.now() - started,
        error: kind,
      });
      if (err instanceof LeadScoringAiError && (manual || !err.retryable)) {
        throw new AppError(
          ERROR_CODES.LSC_PROVIDER_FAILED,
          err.kind === 'auth'
            ? 'The AI provider refused the saved key.'
            : 'The AI provider could not read this chat right now. Try again in a moment.',
          err.kind === 'auth' ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
        );
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
    const parsed = parseDigest(completion.text, {
      allowedStages: allowed,
      ids: prepared.ids,
      mask,
    });
    if (!parsed) {
      // Paid for and unusable: log it with its cost, write nothing, do not retry (a retry pays again).
      await this.logRun(orgId, { ...base, ...spent, status: 'failed', error: 'bad_response' });
      await this.recordTokens(orgId, cfg.model, spent, billedAgainst);
      if (manual) {
        throw new AppError(
          ERROR_CODES.LSC_PROVIDER_FAILED,
          'The AI provider answered something that is not a reading of the chat. Try again.',
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { status: 'skipped', reason: 'bad_response' };
    }

    const suggest = gate.settings.stageSuggestions
      ? stageToSuggest({
          parsed,
          currentStage: brief.lifecycleStage,
          stages,
          stageDate: brief.lifecycleStageDate,
          now: new Date(),
        })
      : null;

    const saved = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      let suggestionId: number | null = null;
      const digestId = await this.chat.insertDigest(tx, orgId, {
        contactId,
        throughAt: prepared.throughAt!,
        messagesRead: prepared.messagesRead,
        inboundRead: prepared.inboundRead,
        language: parsed.language,
        issue: parsed.issue,
        source: 'ai',
        intent: parsed.intent,
        signals: parsed.signals,
        summary: parsed.summary,
        score: parsed.score,
        reasons: parsed.reasons,
        suggestedStage: parsed.suggestedStage,
        stageConfidence: parsed.suggestedStage ? parsed.confidence : null,
        evidence: parsed.evidence,
        model: cfg.model,
        promptTokens: spent.promptTokens,
        completionTokens: spent.completionTokens,
        costUsd: spent.costUsd,
        costSource: spent.costSource,
        billedAgainst,
        durationMs,
        trigger,
      });
      // The score follows the same rule as everywhere: a number a person typed is never replaced.
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
        previousScore: written ? written.previous : scoring.leadScore,
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
      if (written) {
        await this.audit.record(tx, {
          module: CONTACTS_MODULE_KEY,
          recordId: contactId,
          action: 'update',
          delta: { leadScore: { old: written.previous, new: parsed.score } },
        });
      }
      // An open suggestion that no longer starts from the contact's stage is stale; a fresh one replaces the open one.
      await this.chat.supersedeStale(tx, orgId, contactId, brief.lifecycleStage);
      if (suggest) {
        const id = await this.chat.replacePending(tx, orgId, {
          contactId,
          digestId,
          fromStage: brief.lifecycleStage,
          toStage: suggest.to,
          confidence: suggest.confidence,
          reasons: parsed.reasons,
        });
        await this.audit.record(tx, {
          module: SUGGESTION_MODULE_KEY,
          recordId: id,
          action: 'insert',
          delta: {
            toStage: { old: brief.lifecycleStage, new: suggest.to },
            confidence: { old: null, new: suggest.confidence },
          },
        });
        suggestionId = id;
      }
      return { digestId, suggestionId };
    });
    const savedDigestId = saved.digestId;
    // Automatic (the default): the contact moves now and the chat says so, with an Undo. Manual: the suggestion waits in the tray.
    if (suggest && saved.suggestionId !== null && gate.settings.stageAutoApply) {
      await this.autoApply(orgId, saved.suggestionId, brief, suggest.to, stages);
    }
    await announce({
      digestId: savedDigestId,
      source: 'ai',
      intent: parsed.intent,
      signals: parsed.signals,
      summary: parsed.summary,
      score: parsed.score,
      reasons: parsed.reasons,
      suggestedStage: parsed.suggestedStage,
      stageConfidence: parsed.suggestedStage ? parsed.confidence : null,
      language: parsed.language,
      issue: parsed.issue,
      optOut:
        prepared.phraseIntents.includes('not_interested') || parsed.intent === 'not_interested',
    });
    return { status: 'digest', source: 'ai' };
  }

  /**
   * Moves the contact to the suggested stage as the system, only forward and only while it is still where the reading started, keeps
   * the suggestion as `auto_applied` (so the chat's Undo has something to put back) and writes the line into the thread. A failure
   * leaves the suggestion pending for a person; it never fails the reading.
   */
  private async autoApply(
    orgId: number,
    suggestionId: number,
    brief: { uuid: string; lifecycleStage: string },
    to: string,
    stages: readonly StageOption[],
  ): Promise<void> {
    try {
      const position = new Map(stages.map((s) => [s.value, s.position]));
      const labels = new Map(stages.map((s) => [s.value, s.label]));
      const forward = (position.get(to) ?? -1) > (position.get(brief.lifecycleStage) ?? Infinity);
      if (!forward) return;
      const s = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.chat.suggestionById(tx, orgId, suggestionId),
      );
      if (!s || s.status !== 'pending') return;
      const moved = await this.contacts.changeStageAsSystem(orgId, s.contactId, {
        expectFrom: s.fromStage,
        to: s.toStage,
      });
      if (!moved) return;
      await this.db.txAs({ orgId, userId: null }, async (tx) => {
        if (await this.chat.decide(tx, orgId, s.id, 'auto_applied', null)) {
          await this.audit.record(tx, {
            module: SUGGESTION_MODULE_KEY,
            recordId: s.id,
            action: 'update',
            delta: { status: { old: 'pending', new: 'auto_applied' } },
          });
        }
      });
      await this.stageLines.write(orgId, {
        suggestionUuid: s.uuid,
        contactId: s.contactId,
        fromLabel: labels.get(s.fromStage) ?? s.fromStage,
        toLabel: labels.get(s.toStage) ?? s.toStage,
        action: 'auto',
      });
    } catch (err) {
      this.logger.warn({ orgId, suggestionId, err }, 'automatic stage change not applied');
    }
  }

  /** The Undo on the chat line: puts the contact back where the reading found it, if nobody moved it since. */
  async undo(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const s = await this.db.tx((tx) => this.chat.suggestionByUuid(tx, orgId, uuid));
    if (!s) throw AppError.notFound('Suggestion', uuid);
    // The contact as this person may see it: one outside their scope is a 404 here.
    await this.contacts.getByUuid(s.contactUuid);
    const refuse = () =>
      new AppError(
        ERROR_CODES.LSC_SUGGESTION_GONE,
        'This change cannot be undone any more: the contact moved on, or it was already undone.',
        HttpStatus.CONFLICT,
      );
    if (s.status !== 'auto_applied') throw refuse();
    const moved = await this.contacts.changeStageAsSystem(orgId, s.contactId, {
      expectFrom: s.toStage,
      to: s.fromStage,
    });
    if (!moved) throw refuse();
    const labels = await this.db.tx(async (tx) => {
      const stages = await this.chat.stages(tx, orgId);
      await this.chat.markUndone(tx, orgId, s.id, ctx.userId ?? null);
      await this.audit.record(tx, {
        module: SUGGESTION_MODULE_KEY,
        recordId: s.id,
        action: 'update',
        delta: { status: { old: 'auto_applied', new: 'undone' } },
      });
      return new Map(stages.map((x) => [x.value, x.label]));
    });
    await this.stageLines.write(orgId, {
      suggestionUuid: s.uuid,
      contactId: s.contactId,
      fromLabel: labels.get(s.toStage) ?? s.toStage,
      toLabel: labels.get(s.fromStage) ?? s.fromStage,
      action: 'undone',
    });
  }

  /** The "Analyze chat" button: reads now and answers with what was found. */
  async digestNow(contactUuid: string): Promise<LscInsight> {
    const orgId = RequestContextStore.orgId();
    const contactId = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.contactByUuid(tx, orgId, contactUuid),
    );
    if (contactId === null) throw AppError.notFound('Contact', contactUuid);
    await this.digest(orgId, contactId, 'manual');
    return this.insight(contactUuid);
  }

  // --- what the screens read ----------------------------------------------------------------------------------------

  async insight(contactUuid: string): Promise<LscInsight> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    return this.db.tx(async (tx) => {
      const settings = await this.repo.getSettings(tx, orgId);
      const slug = await this.chat.orgSlug(tx, orgId);
      const stages = await this.chat.stages(tx, orgId);
      const labels = new Map(stages.map((s) => [s.value, s.label]));
      const pending = await this.chat.pendingFor(tx, orgId, contactUuid);
      return {
        active:
          cfg.platformEnabled &&
          settings?.enabled === true &&
          settings.chatDigest &&
          isChatDigestPilot(slug),
        digest: await this.chat.latestDigest(tx, orgId, contactUuid),
        suggestion: pending ? toSuggestion(pending, labels) : null,
      };
    });
  }

  async listSuggestions(q: LscSuggestionsQuery): Promise<LscSuggestionsResponse> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const stages = await this.chat.stages(tx, orgId);
      const labels = new Map(stages.map((s) => [s.value, s.label]));
      const { items, nextCursor, hasMore } = await this.chat.listSuggestions(tx, orgId, q);
      return {
        data: items.map((s) => toSuggestion(s, labels)),
        page: { nextCursor, hasMore, limit: q.limit },
      };
    });
  }

  // --- the decision -------------------------------------------------------------------------------------------------

  /**
   * Accepts or dismisses suggestions, each on its own so one that cannot be applied does not stop the others. Accepting changes the
   * stage through the contacts service as the person who accepted, so the usual rules hold: they need the right to edit that contact,
   * the status is kept valid for the new stage, and the audit trail and the stage-changed event are the ordinary ones.
   */
  async decide(input: LscSuggestionDecisionInput): Promise<LscSuggestionDecisionResult> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const result: LscSuggestionDecisionResult = { done: 0, failed: [] };
    for (const id of new Set(input.ids)) {
      try {
        const done =
          input.action === 'accept'
            ? await this.accept(orgId, ctx.userId ?? null, id)
            : await this.dismiss(orgId, ctx.userId ?? null, id);
        if (done) result.done += 1;
        else result.failed.push({ id, code: ERROR_CODES.LSC_SUGGESTION_GONE });
      } catch (err) {
        result.failed.push({ id, code: err instanceof AppError ? err.code : 'INTERNAL_ERROR' });
      }
    }
    return result;
  }

  private async dismiss(orgId: number, userId: number | null, uuid: string): Promise<boolean> {
    return this.db.tx(async (tx) => {
      const s = await this.chat.suggestionByUuid(tx, orgId, uuid);
      if (!s) throw AppError.notFound('Suggestion', uuid);
      const ok = await this.chat.decide(tx, orgId, s.id, 'dismissed', userId);
      if (ok) {
        await this.audit.record(tx, {
          module: SUGGESTION_MODULE_KEY,
          recordId: s.id,
          action: 'update',
          delta: { status: { old: 'pending', new: 'dismissed' } },
        });
      }
      return ok;
    });
  }

  private async accept(orgId: number, userId: number | null, uuid: string): Promise<boolean> {
    const s = await this.db.tx((tx) => this.chat.suggestionByUuid(tx, orgId, uuid));
    if (!s) throw AppError.notFound('Suggestion', uuid);
    if (s.status !== 'pending') return false;
    // The contact as this person may see it (a contact outside their scope is a 404 here), and where it stands now.
    const contact = await this.contacts.getByUuid(s.contactUuid);
    if (contact.lifecycleStage !== s.fromStage) {
      await this.db.tx((tx) => this.chat.decide(tx, orgId, s.id, 'superseded', null));
      return false;
    }
    await this.contacts.update(s.contactUuid, {
      lifecycleStage: s.toStage,
      rowVersion: contact.rowVersion,
    });
    return this.db.tx(async (tx) => {
      const ok = await this.chat.decide(tx, orgId, s.id, 'accepted', userId);
      if (ok) {
        await this.audit.record(tx, {
          module: SUGGESTION_MODULE_KEY,
          recordId: s.id,
          action: 'update',
          delta: { status: { old: 'pending', new: 'accepted' } },
        });
      }
      return true;
    });
  }

  // --- the daily sweep ----------------------------------------------------------------------------------------------

  async sweepOld(retentionDays: number): Promise<number> {
    const out = await this.db.privileged((tx) =>
      this.chat.sweepOld(tx, retentionDays, SUGGESTION_TTL_DAYS),
    );
    return out.digests + out.suggestions + out.expired;
  }

  // --- internals ----------------------------------------------------------------------------------------------------

  private async logRun(orgId: number, w: RunWrite): Promise<void> {
    await this.db
      .txAs({ orgId, userId: null }, (tx) => this.repo.insertRun(tx, orgId, w))
      .catch((err) => this.logger.warn({ orgId, err }, 'chat digest run not logged'));
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
      .catch((err) => this.logger.warn({ orgId, err }, 'chat digest usage not recorded'));
  }
}
