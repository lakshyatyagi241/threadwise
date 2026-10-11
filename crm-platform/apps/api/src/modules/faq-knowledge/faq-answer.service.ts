import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type InboundStoredEvent,
} from '../chat-conversations';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { FlowLaunchService } from '../flow-runtime-engine';
import { FaqLogRepository, type LogWrite } from './faq-log.repository';
import { FaqMatchService } from './faq-match.service';
import { FaqSettingsService } from './faq-settings.service';
import { FaqRepository } from './faq.repository';
import { LOG_QUERY_MAX, answerId } from './faq.rules';

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
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  /** True when an FAQ answered (a text was queued or a flow started), so nothing else answers the same message. */
  async handleInbound(e: InboundStoredEvent): Promise<boolean> {
    const body = e.message.body?.trim() ?? '';
    if (!body) return false;
    // Fresh platform config: right after the operator switches the engine back on, no customer message may be dropped on a cached "off".
    const s = await this.settings.effective(e.orgId, undefined, { fresh: true });
    if (!s.engineEnabled || !s.enabled) return false;

    const result = await this.matcher.match(e.orgId, body, s);
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
          const started = await this.startFlow(e, answer.flowId, body);
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

    const write: LogWrite = {
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
      // What the screens show must respect the workspace's choice not to keep customer text.
      candidates: s.logQueries
        ? result.candidates
        : result.candidates.map((c) => ({ ...c, matchedText: '' })),
      embeddingModel: result.embeddingModel,
      latencyMs: result.latencyMs,
      error: error ?? (outcome === 'provider_error' ? result.note : null),
    };
    await this.db
      .txAs({ orgId: e.orgId, userId: null }, (tx) => this.logs.insert(tx, e.orgId, write))
      .catch((err) => this.logger.warn({ orgId: e.orgId, err }, 'faq match log not written'));
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
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const out = await this.launch.start(e.orgId, {
        flowId,
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
