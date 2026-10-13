import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { FaqLogRepository } from './faq-log.repository';
import { FaqMatchService } from './faq-match.service';
import { FaqSettingsService } from './faq-settings.service';
import { FaqRepository } from './faq.repository';
import { LOG_QUERY_MAX } from './faq.rules';

/** What the Flow "FAQ" node gets back. Ids are internal: the node lives in the same process, nothing here is sent to a browser. */
export type FlowFaqAnswer =
  | { status: 'unavailable'; reason: string }
  | { status: 'no_match'; score: number | null; reason: string }
  | {
      status: 'matched';
      score: number;
      faqUuid: string;
      question: string;
      answerType: 'text' | 'flow';
      answerText: string | null;
      flowId: number | null;
      flowNodeId: string | null;
    };

export interface FlowFaqInput {
  query: string;
  category: string | null;
  /** Replaces the flow's threshold for this node. */
  minScore: number | null;
  conversationId: number | null;
  channelId: number | null;
}

/**
 * The FAQ as a flow step (ADR-0021 addendum): the same matcher the inbound listener and the playground use, asked by a node that
 * already holds the customer's text. It never sends and never starts a flow (the node does, so the run, its pacing and its log stay
 * the runtime's); it writes one `origin: flow` log row so the match is as visible as any other.
 *
 * It matches the FAQs of the flow the run is in (`flowId`). A node placed in a flow is an explicit choice, so it runs whether or not
 * that flow's switch for automatic answering is on; it does not run when the platform operator switched the whole engine off.
 */
@Injectable()
export class FaqFlowService {
  private readonly logger = new Logger(FaqFlowService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: FaqSettingsService,
    private readonly matcher: FaqMatchService,
    private readonly faqs: FaqRepository,
    private readonly logs: FaqLogRepository,
  ) {}

  async answer(orgId: number, flowId: number, i: FlowFaqInput): Promise<FlowFaqAnswer> {
    const s = await this.settings.effective(orgId, flowId, undefined, { fresh: true });
    if (!s.engineEnabled) {
      return { status: 'unavailable', reason: 'FAQ answering is switched off for the platform.' };
    }
    if (i.query.trim() === '')
      return { status: 'no_match', score: null, reason: 'The message to match is empty.' };

    const result = await this.matcher.match(orgId, flowId, i.query, s, {
      category: i.category,
      threshold: i.minScore,
    });
    let answer: Awaited<ReturnType<FaqRepository['answerOf']>> = null;
    if (result.outcome === 'answered' && result.winnerId !== null) {
      answer = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.faqs.answerOf(tx, orgId, result.winnerId!),
      );
    }
    const matched = answer !== null && result.score !== null;
    await this.db
      .txAs({ orgId, userId: null }, (tx) =>
        this.logs.insert(tx, orgId, {
          flowId,
          origin: 'flow',
          conversationId: i.conversationId,
          channelId: i.channelId,
          query: s.logQueries ? Array.from(result.query).slice(0, LOG_QUERY_MAX).join('') : null,
          queryLength: Array.from(result.query).length,
          outcome: matched
            ? answer!.answerType === 'flow'
              ? 'flow_started'
              : 'answered'
            : result.outcome === 'answered'
              ? 'not_sent'
              : result.outcome,
          tier: result.tier,
          matchedFaqId: matched ? result.winnerId : null,
          score: result.score,
          secondScore: result.secondScore,
          matchedText: result.winnerText,
          candidates: s.logQueries
            ? result.candidates
            : result.candidates.map((c) => ({ ...c, matchedText: '' })),
          embeddingModel: result.embeddingModel,
          latencyMs: result.latencyMs,
          error: matched
            ? null
            : result.outcome === 'answered'
              ? 'The FAQ was paused or deleted while it was matching.'
              : null,
          verify: result.verify,
        }),
      )
      .catch((err) => this.logger.warn({ orgId, err }, 'faq flow log not written'));

    if (!matched || answer === null || result.score === null || result.faqId === null) {
      return {
        status: 'no_match',
        score: result.score,
        reason: result.note ?? `No FAQ reached the bar (${result.outcome.replace(/_/g, ' ')}).`,
      };
    }
    return {
      status: 'matched',
      score: result.score,
      faqUuid: result.faqId,
      question: answer.question,
      answerType: answer.answerType === 'flow' ? 'flow' : 'text',
      answerText: answer.answerText,
      flowId: answer.flowId,
      flowNodeId: answer.flowNodeId,
    };
  }
}
