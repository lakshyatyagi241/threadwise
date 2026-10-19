import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  FaqMatchDecision,
  FaqMatchOutcome,
  FaqMatchTier,
  FaqVerifyInfo,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/incr-with-ttl';
import { FaqConfigService } from './faq-config.service';
import { FaqEmbeddingService, FaqUnavailableError } from './faq-embedding.service';
import { FaqSettingsService, type EffectiveSettings } from './faq-settings.service';
import { FaqVerifyService } from './faq-verify.service';
import { FaqRepository } from './faq.repository';
import {
  TRIGRAM_MIN,
  bestPerFaq,
  decide,
  isMatchable,
  queryText,
  round4,
  toCandidates,
  toVectorLiteral,
  type Scored,
} from './faq.rules';

export interface MatchResult extends FaqMatchDecision {
  /** Internal id of the winning FAQ, for the caller that acts on it (never sent over the wire). */
  winnerId: number | null;
  winnerText: string | null;
  /** The text that was matched after tidying, what the log stores when the workspace keeps text. */
  query: string;
}

/** Per-call narrowing: the Flow "FAQ" node may match one category and bring its own bar. */
export interface MatchOptions {
  category?: string | null;
  /** Replaces the workspace threshold for this call only. */
  threshold?: number | null;
}

/** One workspace's counter of semantic matches this hour (the abuse and cost guard). */
const hourBucket = (): string => new Date().toISOString().slice(0, 13);

/**
 * Decides which FAQ, if any, answers a customer message (ADR-0021). Tiers, in order: an exact phrase; the vector similarity; a
 * trigram fallback when no vector can be used (provider down, no key, nothing indexed yet, hourly cap reached). It never writes and
 * never sends: the caller (the inbound listener, the playground) logs the decision and acts on it.
 */
@Injectable()
export class FaqMatchService {
  private readonly logger = new Logger(FaqMatchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FaqRepository,
    private readonly settings: FaqSettingsService,
    private readonly config: FaqConfigService,
    private readonly embeddings: FaqEmbeddingService,
    private readonly verifier: FaqVerifyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async match(
    orgId: number,
    flowId: number,
    raw: string,
    preloaded?: EffectiveSettings,
    opts: MatchOptions = {},
  ): Promise<MatchResult> {
    const started = Date.now();
    const query = queryText(raw);
    const base0 = preloaded ?? (await this.settings.effective(orgId, flowId));
    const s = opts.threshold != null ? { ...base0, threshold: opts.threshold } : base0;
    const category = opts.category?.trim() ? opts.category.trim() : null;
    const cfg = await this.config.get();
    const model = cfg.embeddingModel;
    const base = (partial: Partial<MatchResult> & Pick<MatchResult, 'outcome'>): MatchResult => ({
      tier: null,
      faqId: null,
      score: null,
      secondScore: null,
      threshold: s.threshold,
      minMargin: s.minMargin,
      candidates: [],
      embeddingModel: model,
      latencyMs: Date.now() - started,
      note: null,
      verify: null,
      winnerId: null,
      winnerText: null,
      query,
      ...partial,
    });
    const finish = async (
      ranked: Scored[],
      tier: FaqMatchTier,
      opts: { threshold: number; exact: boolean },
      note: string | null,
      errored: boolean,
    ): Promise<MatchResult> => {
      const d = decide(ranked, {
        threshold: opts.threshold,
        minMargin: s.minMargin,
        exact: opts.exact,
      });
      // A vendor failure that the trigram tier could not make up for is reported as such, not as "no match".
      // `decide` says no_faqs for an empty list; here the flow is known to have active FAQs (checked above), so an empty list
      // means nothing was similar enough, which is below_threshold.
      const settled: FaqMatchOutcome = d.outcome === 'no_faqs' ? 'below_threshold' : d.outcome;
      let outcome: FaqMatchOutcome = errored && settled !== 'answered' ? 'provider_error' : settled;
      let verify: FaqVerifyInfo | null = null;
      let finalNote = note;
      // The borderline check only looks at a semantic answer that just cleared the bar, and can only take it back.
      if (tier === 'semantic' && d.outcome === 'answered' && d.winner) {
        verify = await this.verifier.check({
          orgId,
          mode: s.verifyMode,
          band: s.verifyBand,
          threshold: d.threshold,
          score: d.winner.score,
          message: query,
          faqQuestion: d.winner.question,
          matchedText: d.winner.text,
          runnerUpQuestion: ranked.find((r) => r.faqId !== d.winner!.faqId)?.question ?? null,
        });
        if (verify?.verdict === 'rejected') {
          outcome = 'below_threshold';
          finalNote = `A second check judged that this FAQ does not answer the message${verify.reason ? `: ${verify.reason}` : '.'}`;
        }
      }
      const answered = outcome === 'answered';
      return base({
        outcome,
        tier,
        faqId: answered ? d.winner!.faqUuid : null,
        winnerId: answered ? d.winner!.faqId : null,
        winnerText: answered ? d.winner!.text : null,
        score: d.winner ? round4(d.winner.score) : null,
        secondScore: d.secondScore === null ? null : round4(d.secondScore),
        threshold: d.threshold,
        candidates: toCandidates(ranked),
        note: finalNote,
        verify,
      });
    };

    const active = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.activeFaqCount(tx, orgId, flowId),
    );
    if (active === 0) return base({ outcome: 'no_faqs', note: 'This flow has no active FAQs.' });
    if (!isMatchable(query)) {
      return base({
        outcome: 'below_threshold',
        note: 'Too short to match: a question needs at least two characters and a letter or digit.',
      });
    }

    const exact = bestPerFaq(
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.exact(tx, orgId, flowId, query, category),
      ),
    );
    if (exact.length > 0)
      return await finish(exact, 'exact', { threshold: s.threshold, exact: true }, null, false);

    let note: string | null = null;
    let errored = false;
    const ready = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.readyVariationCount(tx, orgId, flowId, model),
    );
    if (ready === 0) {
      note = 'No variation has its vector yet (still indexing), so spelling similarity was used.';
    } else if (await this.overCap(orgId, cfg.semanticPerHour)) {
      note = 'The hourly limit for semantic matching was reached, so spelling similarity was used.';
    } else {
      try {
        const { vector } = await this.embeddings.embedQuery(orgId, query);
        const rows = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.vector(tx, orgId, flowId, model, toVectorLiteral(vector), category),
        );
        return await finish(
          bestPerFaq(rows),
          'semantic',
          { threshold: s.threshold, exact: false },
          null,
          false,
        );
      } catch (err) {
        errored = true;
        note =
          err instanceof FaqUnavailableError
            ? `${err.message} Spelling similarity was used instead.`
            : 'The embedding provider failed. Spelling similarity was used instead.';
        if (!(err instanceof FaqUnavailableError))
          this.logger.warn({ orgId, err }, 'faq semantic match failed');
      }
    }

    const tri = bestPerFaq(
      await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.trigram(tx, orgId, flowId, query, category),
      ),
    );
    return await finish(tri, 'trigram', { threshold: TRIGRAM_MIN, exact: false }, note, errored);
  }

  /** True once this workspace used its semantic matches for the hour. A counter that is down never blocks a customer. */
  private async overCap(orgId: number, cap: number): Promise<boolean> {
    try {
      const key = `faq:rate:${orgId}:${hourBucket()}`;
      const n = await incrWithTtl(this.redis, key, 3700);
      return n > cap;
    } catch {
      return false;
    }
  }
}
