import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type InboundStoredEvent,
} from '../chat-conversations';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { FlowLaunchService, FlowTriggerService, KINDS_OF_PROVIDER } from '../flow-runtime-engine';
import { FaqConfigService } from './faq-config.service';
import { FaqLogRepository, type LogWrite } from './faq-log.repository';
import { FaqMatchService, type MatchResult } from './faq-match.service';
import { FaqSettingsService, type EffectiveSettings } from './faq-settings.service';
import { FaqRepository } from './faq.repository';
import { LOG_QUERY_MAX, answerId, candidateFlows, pickAttempt } from './faq.rules';

interface Attempt {
  flowId: number;
  outcome: MatchResult['outcome'];
  score: number | null;
  result: MatchResult;
  s: EffectiveSettings;
}

/**
 * What happens after a customer's message matched (or did not): the answer is queued through the inbox's own send path (so the
 * 24 hour window, the channel and the dispatch retry all apply), or the linked flow starts. Every decision is logged once, with the
 * outcome that really happened, so the log says "answered", "flow started" or "matched but could not be sent" truthfully.
 */
@Injectable()
export class FaqAnswerService {
  private readonly logger = new Logger(FaqAnswerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: FaqSettingsService,
    private readonly matcher: FaqMatchService,
    private readonly faqs: FaqRepository,
    private readonly logs: FaqLogRepository,
    private readonly launch: FlowLaunchService,
    private readonly triggers: FlowTriggerService,
    private readonly config: FaqConfigService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  /**
   * True when an FAQ answered (a text was queued or a flow started), so nothing else answers the same message.
   *
   * Which FAQs may answer: those of the flows that are published and active, have the switch on and an active FAQ, and sit on the
   * channel the message came in on. The customer's live run's flow is tried first; every candidate runs its own matcher with its own
   * settings, and the best answered score wins (a tie goes to the live run's flow, then the lowest flow id). One log row is written,
   * for the winner, or for the nearest candidate when none answered.
   */
  async handleInbound(e: InboundStoredEvent): Promise<boolean> {
    const body = e.message.body?.trim() ?? '';
    if (!body) return false;
    // Fresh platform config: right after the operator switches the engine back on, no customer message may be dropped on a cached "off".
    const cfg = await this.config.getFresh();
    if (!cfg.engineEnabled) return false;

    const bound = await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
      this.faqs.answeringFlows(tx, e.orgId),
    );
    if (bound.length === 0) return false;
    const liveFlowId = await this.triggers.liveFlowId(e.orgId, e.channelId, e.peerKey);
    const flowIds = candidateFlows(
      bound,
      { channelId: e.channelId, channelKind: e.channelKind },
      KINDS_OF_PROVIDER,
      liveFlowId,
    );

    const attempts: Attempt[] = [];
    for (const flowId of flowIds) {
      const s = await this.settings.effective(e.orgId, flowId, undefined, { fresh: true });
      // Switched off between the list and now: that flow stays silent.
      if (!s.enabled) continue;
      const result = await this.matcher.match(e.orgId, flowId, body, s);
      attempts.push({ flowId, outcome: result.outcome, score: result.score, result, s });
    }
    const picked = pickAttempt(attempts, liveFlowId);
    if (!picked) return false;
    const { flowId, result, s } = picked;

    let outcome = result.outcome;
    let error: string | null = null;
    let consumed = false;

    if (result.outcome === 'answered' && result.winnerId !== null) {
      const answer = await this.db.txAs({ orgId: e.orgId, userId: null }, (tx) =>
        this.faqs.answerOf(tx, e.orgId, result.winnerId!),
      );
      if (!answer) {
        outcome = 'not_sent';
        error = 'The FAQ was paused or deleted while it was matching.';
      } else if (answer.answerType === 'flow') {
        if (answer.flowId === null) {
          outcome = 'not_sent';
          error = 'The flow this FAQ starts no longer exists.';
        } else {
          const started = await this.startFlow(e, answer.flowId, body, answer.flowNodeId);
          outcome = started.ok ? 'flow_started' : 'not_sent';
          error = started.ok ? null : started.error;
          consumed = started.ok;
        }
      } else if (answer.answerText) {
        const sent = await this.sendText(e, answer.answerText);
        outcome = sent.ok ? 'answered' : 'not_sent';
        error = sent.ok ? null : sent.error;
        consumed = sent.ok;
      } else {
        outcome = 'not_sent';
        error = 'The FAQ has no answer text.';
      }
    }

    // Nothing answered and the owner set a fallback: the customer hears it, once, through the same send path. The log keeps the real
    // outcome (below_threshold ...), so the message still shows on the Unanswered screen for the team to teach the FAQ.
    if (
      !consumed &&
      s.fallbackMessage &&
      (outcome === 'below_threshold' || outcome === 'low_margin' || outcome === 'no_faqs')
    ) {
      const sent = await this.sendText(e, s.fallbackMessage);
      consumed = sent.ok;
      if (!sent.ok) error = `The fallback message could not be sent: ${sent.error}`;
    }

    const write: LogWrite = {
      flowId,
      origin: 'inbound',
      conversationId: e.conversationId,
      channelId: e.channelId,
      query: s.logQueries ? Array.from(result.query).slice(0, LOG_QUERY_MAX).join('') : null,
      queryLength: Array.from(result.query).length,
      outcome,
      tier: result.tier,
      matchedFaqId:
        outcome === 'answered' || outcome === 'flow_started' || outcome === 'not_sent'
          ? result.winnerId
          : null,
      score: result.score,
      secondScore: result.secondScore,
      matchedText: result.winnerText,
      // What the screens show must respect the flow's choice not to keep customer text.
      candidates: s.logQueries
        ? result.candidates
        : result.candidates.map((c) => ({ ...c, matchedText: '' })),
      embeddingModel: result.embeddingModel,
      latencyMs: result.latencyMs,
      error: error ?? (outcome === 'provider_error' ? result.note : null),
      verify: result.verify,
    };
    await this.db
      .txAs({ orgId: e.orgId, userId: null }, (tx) => this.logs.insert(tx, e.orgId, write))
      .catch((err) =>
        this.logger.warn({ orgId: e.orgId, flowId, err }, 'faq match log not written'),
      );
    return consumed;
  }

  private async sendText(
    e: InboundStoredEvent,
    body: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await RequestContextStore.run(
        {
          requestId: `faq-${randomUUID()}`,
          orgId: e.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () =>
          this.conversations.enqueueOutbound({
            conversationId: e.conversationUuid,
            // One answer per customer message, however often the job is retried.
            clientMessageId: answerId(e.messageUuid),
            content: { kind: 'text', body },
            sender: { kind: 'bot' },
          }),
      );
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'send failed';
      this.logger.warn({ orgId: e.orgId, err: msg }, 'faq answer could not be queued');
      return { ok: false, error: msg.slice(0, 300) };
    }
  }

  private async startFlow(
    e: InboundStoredEvent,
    flowId: number,
    typed: string,
    startNodeId: string | null,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const out = await this.launch.start(e.orgId, {
        flowId,
        startNodeId,
        contactId: e.contactId,
        channelId: e.channelId,
        peerKey: e.peerKey,
        source: 'keyword',
        triggerText: typed,
        pushName: e.peerName,
        conversationId: e.conversationId,
        requirePublished: true,
        withSubscriber: false,
      });
      if (out.outcome === 'started') return { ok: true };
      return {
        ok: false,
        error: out.outcome === 'failed' ? out.reason : `flow not started (${out.outcome})`,
      };
    } catch (err) {
      return {
        ok: false,
        error: (err instanceof Error ? err.message : 'flow start failed').slice(0, 300),
      };
    }
  }
}
