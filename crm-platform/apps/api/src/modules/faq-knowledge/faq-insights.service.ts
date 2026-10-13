import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type FaqInsights,
  type FaqInsightsQuery,
  type FaqLogResponse,
  type FaqMatchDecision,
  type LearnFaqLogInput,
  type ListFaqLogQuery,
  type TestFaqQueryInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage, decodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { FaqConfigService } from './faq-config.service';
import { FaqLogRepository } from './faq-log.repository';
import { FaqMatchService, type MatchResult } from './faq-match.service';
import { FaqRepository } from './faq.repository';
import { toLogItem } from './faq.mapper';
import { LOG_QUERY_MAX, sameKey } from './faq.rules';

/** What the match log shows, the playground that runs the matcher without sending anything, and "learn from this message". */
@Injectable()
export class FaqInsightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logs: FaqLogRepository,
    private readonly faqs: FaqRepository,
    private readonly matcher: FaqMatchService,
    private readonly config: FaqConfigService,
    private readonly audit: AuditService,
  ) {}

  async summary(flowUuid: string, query: FaqInsightsQuery): Promise<FaqInsights> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      return this.logs.insights(tx, orgId, flow.id, query.days);
    });
  }

  async list(flowUuid: string, query: ListFaqLogQuery): Promise<FaqLogResponse> {
    const orgId = RequestContextStore.orgId();
    const afterId = query.cursor ? decodeCursor(query.cursor).id : null;
    const rows = await this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      let faqId: number | undefined;
      if (query.faqId) {
        const f = await this.faqs.idsByUuids(tx, orgId, flow.id, [query.faqId]);
        // A FAQ that is not in this flow matches nothing rather than leaking that it exists elsewhere.
        if (f.length === 0) return [];
        faqId = f[0]!.id;
      }
      return this.logs.list(tx, orgId, flow.id, {
        limit: query.limit,
        afterId,
        view: query.view,
        search: query.search,
        faqId,
      });
    });
    const { items, page } = buildPage(rows, query.limit);
    return { data: items.map(toLogItem), page };
  }

  /**
   * The playground: runs the real matcher on a typed message and shows the decision with its numbers, sends nothing. It is logged
   * as `origin: test` so it never counts in the insights or the unanswered list.
   */
  async test(flowUuid: string, input: TestFaqQueryInput): Promise<FaqMatchDecision> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    if (!cfg.engineEnabled) {
      throw new AppError(
        ERROR_CODES.FAQ_ENGINE_DISABLED,
        'FAQ answering is switched off for the whole platform right now.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const flow = await this.db.tx((tx) => this.faqs.requireFlow(tx, orgId, flowUuid));
    const result = await this.matcher.match(orgId, flow.id, input.query);
    await this.db.tx((tx) =>
      this.logs.insert(tx, orgId, {
        flowId: flow.id,
        origin: 'test',
        conversationId: null,
        channelId: null,
        query: Array.from(result.query).slice(0, LOG_QUERY_MAX).join(''),
        queryLength: Array.from(result.query).length,
        outcome: result.outcome,
        tier: result.tier,
        matchedFaqId: result.winnerId,
        score: result.score,
        secondScore: result.secondScore,
        matchedText: result.winnerText,
        candidates: result.candidates,
        embeddingModel: result.embeddingModel,
        latencyMs: result.latencyMs,
        error: null,
        verify: result.verify,
      }),
    );
    return publicDecision(result);
  }

  /** The customer's unanswered message becomes a `learned` variation of the FAQ it should have reached. */
  async learn(
    flowUuid: string,
    logUuid: string,
    input: LearnFaqLogInput,
  ): Promise<{ added: boolean }> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    return this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      const log = await this.logs.findByUuid(tx, orgId, flow.id, logUuid);
      if (!log) throw AppError.notFound('Log entry', logUuid);
      if (!log.query) {
        throw AppError.validation('This message was not kept, so it cannot be learned.', [
          { path: 'id', message: 'Query logging was off when this message arrived.' },
        ]);
      }
      const faq = await this.faqs.findByUuid(tx, orgId, flow.id, input.faqId, cfg.embeddingModel);
      if (!faq) throw AppError.notFound('FAQ', input.faqId);
      const have = await this.faqs.variationCount(tx, orgId, faq.id);
      if (have >= cfg.maxVariationsPerFaq) {
        throw new AppError(
          ERROR_CODES.FAQ_LIMIT_REACHED,
          `This FAQ is at its limit of ${cfg.maxVariationsPerFaq} variations.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const created = await this.faqs.insertVariations(tx, orgId, faq.id, [log.query], 'learned');
      await this.logs.resolve(tx, orgId, log.internalId);
      await this.logs.resolveSameQuery(tx, orgId, flow.id, log.query);
      if (created.length > 0) {
        await this.audit.record(tx, {
          module: 'faqs',
          recordId: faq.id,
          action: 'update',
          delta: { variations: { old: have, new: have + 1 } },
        });
      }
      return { added: created.length > 0 && sameKey(log.query) !== '' };
    });
  }

  async dismiss(flowUuid: string, logUuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    await this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      const log = await this.logs.findByUuid(tx, orgId, flow.id, logUuid);
      if (!log) throw AppError.notFound('Log entry', logUuid);
      await this.logs.resolve(tx, orgId, log.internalId);
      if (log.query) await this.logs.resolveSameQuery(tx, orgId, flow.id, log.query);
    });
  }
}

/** The wire shape of a decision: the internal fields stay inside. */
export function publicDecision(r: MatchResult): FaqMatchDecision {
  return {
    outcome: r.outcome,
    tier: r.tier,
    faqId: r.faqId,
    score: r.score,
    secondScore: r.secondScore,
    threshold: r.threshold,
    minMargin: r.minMargin,
    candidates: r.candidates,
    embeddingModel: r.embeddingModel,
    latencyMs: r.latencyMs,
    note: r.note,
    verify: r.verify,
  };
}
