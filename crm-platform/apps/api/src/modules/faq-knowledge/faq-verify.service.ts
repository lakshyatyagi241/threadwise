import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { FaqVerifyInfo } from '@crm/contracts';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/incr-with-ttl';
import {
  FAQ_AI_PORT,
  FaqAiError,
  type FaqAiPort,
} from '../../infra/providers/faq-knowledge/faq-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { FaqConfigService } from './faq-config.service';
import { inVerifyBand, parseVerdict, verifyPrompt } from './faq.rules';

const AI_PROVIDER = 'openrouter';
const hourBucket = (): string => new Date().toISOString().slice(0, 13);

export interface VerifyInput {
  orgId: number;
  mode: 'off' | 'borderline';
  band: number;
  threshold: number;
  score: number;
  message: string;
  faqQuestion: string;
  matchedText: string;
  runnerUpQuestion: string | null;
}

/**
 * The borderline check (ADR-0021 addendum): when the vector score only just cleared the threshold, a small chat model is asked
 * whether the FAQ really answers the message. It can only veto an answer, never create one, and it never breaks answering: a failed
 * or unreadable check leaves the match standing. Returns null when the check does not apply (so nothing is logged for it).
 *
 * One call costs a few hundred tokens. The platform operator can switch it off for everyone, change the model and cap the calls a
 * workspace may make per hour; the same key resolution, allowance guard and token ledger as the embeddings apply.
 */
@Injectable()
export class FaqVerifyService {
  private readonly logger = new Logger(FaqVerifyService.name);

  constructor(
    private readonly config: FaqConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(FAQ_AI_PORT) private readonly ai: FaqAiPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(i: VerifyInput): Promise<FaqVerifyInfo | null> {
    if (i.mode !== 'borderline') return null;
    if (!inVerifyBand(i.score, i.threshold, i.band)) return null;
    const cfg = await this.config.get();
    if (!cfg.verifyEnabled) {
      return {
        verdict: 'skipped',
        model: null,
        reason: 'The check is switched off for the platform.',
      };
    }
    if (await this.overCap(i.orgId, cfg.verifyPerHour)) {
      return {
        verdict: 'skipped',
        model: cfg.verifyModel,
        reason: 'The hourly limit for checks was reached.',
      };
    }
    const resolved = await this.keys.resolve(i.orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      return { verdict: 'skipped', model: cfg.verifyModel, reason: 'No AI key is set up.' };
    }
    if (resolved.source === 'admin') {
      try {
        await this.meter.guard(i.orgId);
      } catch {
        return {
          verdict: 'skipped',
          model: cfg.verifyModel,
          reason: "This month's AI allowance is used up.",
        };
      }
    }
    const prompt = verifyPrompt(i.message, i.faqQuestion, i.matchedText, i.runnerUpQuestion);
    try {
      const out = await this.ai.judge({
        apiKey: resolved.key,
        model: cfg.verifyModel,
        system: prompt.system,
        user: prompt.user,
      });
      await this.meter
        .record(i.orgId, {
          provider: AI_PROVIDER,
          model: cfg.verifyModel,
          promptTokens: out.promptTokens,
          completionTokens: out.completionTokens,
          billedAgainst: resolved.source,
        })
        .catch((err) => this.logger.warn({ orgId: i.orgId, err }, 'faq verify usage not recorded'));
      const verdict = parseVerdict(out.text);
      if (!verdict) {
        return {
          verdict: 'error',
          model: cfg.verifyModel,
          reason: 'The model did not answer in the expected form, so the match stood.',
        };
      }
      return {
        verdict: verdict.answers ? 'confirmed' : 'rejected',
        model: cfg.verifyModel,
        reason: verdict.reason || null,
      };
    } catch (err) {
      if (!(err instanceof FaqAiError))
        this.logger.warn({ orgId: i.orgId, err }, 'faq verify failed');
      return {
        verdict: 'error',
        model: cfg.verifyModel,
        reason:
          err instanceof FaqAiError && err.kind === 'auth'
            ? 'The AI provider refused the key, so the match stood.'
            : 'The check could not run, so the match stood.',
      };
    }
  }

  private async overCap(orgId: number, cap: number): Promise<boolean> {
    try {
      const key = `faq:verify:${orgId}:${hourBucket()}`;
      const n = await incrWithTtl(this.redis, key, 3700);
      return n > cap;
    } catch {
      return false;
    }
  }
}
