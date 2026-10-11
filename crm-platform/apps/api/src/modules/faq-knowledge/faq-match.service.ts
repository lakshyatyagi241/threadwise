import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { FaqMatchDecision, FaqMatchOutcome, FaqMatchTier } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { FaqConfigService } from './faq-config.service';
import { FaqEmbeddingService, FaqUnavailableError } from './faq-embedding.service';
import { FaqSettingsService, type EffectiveSettings } from './faq-settings.service';
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async match(orgId: number, raw: string, preloaded?: EffectiveSettings): Promise<MatchResult> {
    const started = Date.now();
    const query = queryText(raw);
    const s = preloaded ?? (await this.settings.effective(orgId));
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
      winnerId: null,
      winnerText: null,
      query,
      ...partial,
    });
    const finish = (
      ranked: Scored[],
      tier: FaqMatchTier,
      opts: { threshold: number; exact: boolean },
      note: string | null,
      errored: boolean,
    ): MatchResult => {
      const d = decide(ranked, {
        threshold: opts.threshold,
        minMargin: s.minMargin,
        exact: opts.exact,
      });
      // A vendor failure that the trigram tier could not make up for is reported as such, not as "no match".
      // `decide` says no_faqs for an empty list; here the workspace is known to have active FAQs (checked above), so an empty list
      // means nothing was similar enough, which is below_threshold.
      const settled: FaqMatchOutcome = d.outcome === 'no_faqs' ? 'below_threshold' : d.outcome;
      const outcome: FaqMatchOutcome =
        errored && settled !== 'answered' ? 'provider_error' : settled;
      return base({
        outcome,
        tier,
        faqId: d.outcome === 'answered' ? d.winner!.faqUuid : null,
        winnerId: d.outcome === 'answered' ? d.winner!.faqId : null,
        winnerText: d.outcome === 'answered' ? d.winner!.text : null,
        score: d.winner ? round4(d.winner.score) : null,
        secondScore: d.secondScore === null ? null : round4(d.secondScore),
        threshold: d.threshold,
        candidates: toCandidates(ranked),
        note,
      });
    };

    const active = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.activeFaqCount(tx, orgId),
    );
    if (active === 0)
      return base({ outcome: 'no_faqs', note: 'This workspace has no active FAQs.' });
    if (!isMatchable(query)) {
      return base({
        outcome: 'below_threshold',
        note: 'Too short to match: a question needs at least two characters and a letter or digit.',
      });
    }

    const exact = bestPerFaq(
      await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.exact(tx, orgId, query)),
    );
    if (exact.length > 0)
      return finish(exact, 'exact', { threshold: s.threshold, exact: true }, null, false);

    let note: string | null = null;
    let errored = false;
    const ready = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.readyVariationCount(tx, orgId, model),
    );
    if (ready === 0) {
      note = 'No variation has its vector yet (still indexing), so spelling similarity was used.';
    } else if (await this.overCap(orgId, cfg.semanticPerHour)) {
      note = 'The hourly limit for semantic matching was reached, so spelling similarity was used.';
    } else {
      try {
        const { vector } = await this.embeddings.embedQuery(orgId, query);
        const rows = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.vector(tx, orgId, model, toVectorLiteral(vector)),
        );
        return finish(
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
      await this.db.txAs({ orgId, userId: null }, (tx) => this.repo.trigram(tx, orgId, query)),
    );
    return finish(tri, 'trigram', { threshold: TRIGRAM_MIN, exact: false }, note, errored);
  }

  /** True once this workspace used its semantic matches for the hour. A counter that is down never blocks a customer. */
  private async overCap(orgId: number, cap: number): Promise<boolean> {
    try {
      const key = `faq:rate:${orgId}:${hourBucket()}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, 3700);
      return n > cap;
    } catch {
      return false;
    }
  }
}
