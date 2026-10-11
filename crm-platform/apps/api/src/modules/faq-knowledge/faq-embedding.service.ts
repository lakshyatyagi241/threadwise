import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  FAQ_AI_PORT,
  FaqAiError,
  type FaqAiPort,
} from '../../infra/providers/faq-knowledge/faq-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { FaqConfigService } from './faq-config.service';
import { normalise } from './faq.rules';

/** Why an embedding could not be made, in terms a screen can show without leaking the vendor's answer. */
export class FaqUnavailableError extends Error {
  constructor(
    readonly kind:
      'no_key' | 'allowance' | 'auth' | 'rate_limited' | 'timeout' | 'provider' | 'bad_response',
    message: string,
  ) {
    super(message);
    this.name = 'FaqUnavailableError';
  }
}

const QUERY_CACHE_TTL_S = 6 * 3600;
const AI_PROVIDER = 'openrouter';

/**
 * Turns texts into vectors for a workspace (ADR-0021). Resolves the key the AI keys domain says this workspace uses, asks the cap
 * before a platform-key call, calls the port with no database transaction open, and records the tokens in the ledger.
 *
 * Query vectors are cached for six hours by (model, text): the same customer question arrives many times, and the vector of a text
 * does not depend on who asked. The cache holds no tenant data.
 */
@Injectable()
export class FaqEmbeddingService {
  private readonly logger = new Logger(FaqEmbeddingService.name);

  constructor(
    private readonly config: FaqConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    @Inject(FAQ_AI_PORT) private readonly ai: FaqAiPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Vectors for `texts` (index time: nothing is cached). Throws FaqUnavailableError. */
  async embedMany(
    orgId: number,
    texts: readonly string[],
  ): Promise<{ vectors: number[][]; model: string }> {
    // Fresh: a model switched a moment ago must not be missed (the vectors would be stored under the replaced model).
    const cfg = await this.config.getFresh();
    const model = cfg.embeddingModel;
    const vectors = await this.call(orgId, model, [...texts]);
    return { vectors, model };
  }

  /** The vector of one customer message, from the cache when the same text was seen lately. */
  async embedQuery(
    orgId: number,
    query: string,
  ): Promise<{ vector: number[]; model: string; cached: boolean }> {
    const cfg = await this.config.get();
    const model = cfg.embeddingModel;
    const key = `faq:q:${model}:${createHash('sha256').update(query.toLowerCase()).digest('hex')}`;
    try {
      const hit = await this.redis.getBuffer(key);
      if (hit && hit.length > 0 && hit.length % 4 === 0) {
        const f = new Float32Array(hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.length));
        return { vector: Array.from(f), model, cached: true };
      }
    } catch {
      // A cache that is down is a cache miss.
    }
    const [vector] = await this.call(orgId, model, [query]);
    try {
      const buf = Buffer.from(new Float32Array(vector!).buffer);
      await this.redis.set(key, buf, 'EX', QUERY_CACHE_TTL_S);
    } catch {
      // Not caching is fine.
    }
    return { vector: vector!, model, cached: false };
  }

  private async call(orgId: number, model: string, inputs: string[]): Promise<number[][]> {
    const dims = this.config.dimensionsOf(model);
    if (dims === null)
      throw new FaqUnavailableError(
        'provider',
        'The embedding model is not on the platform allow-list.',
      );
    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      throw new FaqUnavailableError(
        'no_key',
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
      );
    }
    if (resolved.source === 'admin') {
      try {
        await this.meter.guard(orgId);
      } catch {
        throw new FaqUnavailableError('allowance', "This month's AI allowance is used up.");
      }
    }
    try {
      const out = await this.ai.embed({ apiKey: resolved.key, model, inputs, dimensions: dims });
      await this.meter
        .record(orgId, {
          provider: AI_PROVIDER,
          model,
          promptTokens: out.promptTokens,
          completionTokens: 0,
          billedAgainst: resolved.source,
        })
        .catch((err) => this.logger.warn({ orgId, err }, 'faq embedding usage not recorded'));
      return out.vectors.map(normalise);
    } catch (err) {
      if (err instanceof FaqAiError) {
        throw new FaqUnavailableError(
          err.kind === 'dimension_mismatch' ? 'bad_response' : err.kind,
          err.message,
        );
      }
      throw err;
    }
  }
}
