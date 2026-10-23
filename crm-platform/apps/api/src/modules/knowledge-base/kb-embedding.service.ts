import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { isWalletEmpty } from '../../common/errors/wallet-empty';
import { fingerprint, stableUsageId } from '../../common/stable-usage-id';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  KB_AI_PORT,
  KbAiError,
  type KbAiPort,
} from '../../infra/providers/knowledge-base/kb-ai.port';
import { AiKeyResolver, AiTokenMeter } from '../ai-keys-usage-admin';
import { AiChargeService } from '../wallet-message-billing';
import { KbConfigService } from './kb-config.service';
import { normalise } from './kb.rules';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('kb_query_embedding');

/** Why an embedding could not be made, in terms a screen can show without leaking the vendor's answer. */
export class KbUnavailableError extends Error {
  constructor(
    readonly kind:
      | 'no_key'
      | 'allowance'
      | 'wallet'
      | 'auth'
      | 'rate_limited'
      | 'timeout'
      | 'provider'
      | 'bad_response',
    message: string,
  ) {
    super(message);
    this.name = 'KbUnavailableError';
  }
}

const QUERY_CACHE_TTL_S = 6 * 3600;
const AI_PROVIDER = 'openrouter';
/** What the customer's expense log says: indexing is the bulk work, a search is one small embedding per customer message. */
const INDEX_LABEL = 'AI knowledge base indexing';
const SEARCH_LABEL = 'AI knowledge base search';
const USAGE_SOURCE = 'kb_embedding';

/** What one embedding call is billed as: a stable id (a retry of the same work bills once) and the line the customer reads. */
interface Billing {
  usageId: string;
  label: string;
}

/**
 * Turns texts into vectors for a workspace . Resolves the key the AI keys domain says this workspace uses, asks the cap and the
 * wallet before a platform-key call, calls the port with no database transaction open, records the tokens in the ledger and charges
 * the wallet (a workspace on its own key pays its vendor and is never charged).
 *
 * Query vectors are cached for six hours by (model, text): the same customer question arrives many times, and the vector of a text
 * does not depend on who asked. The cache holds no tenant data, and a cache hit is free: only a call that reached the vendor is billed.
 */
@Injectable()
export class KbEmbeddingService {
  private readonly logger = new Logger(KbEmbeddingService.name);

  constructor(
    private readonly config: KbConfigService,
    private readonly keys: AiKeyResolver,
    private readonly meter: AiTokenMeter,
    private readonly charge: AiChargeService,
    @Inject(KB_AI_PORT) private readonly ai: KbAiPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Vectors for `texts` (index time: nothing is cached). Throws KbUnavailableError.
   *
   * The whole call is ONE charge, however many passages it holds. `batchKey` (see `embedBatchKey`) names the batch: it makes a batch
   * that is embedded again after a failed write bill once. Without one the texts themselves name it.
   */
  async embedMany(
    orgId: number,
    texts: readonly string[],
    batchKey?: string,
  ): Promise<{ vectors: number[][]; model: string }> {
    // Fresh: a model switched a moment ago must not be missed (the vectors would be stored under the replaced model).
    const cfg = await this.config.getFresh();
    const model = cfg.embeddingModel;
    // The model is part of the id: the same passages embedded again for a new model are new work, and new money.
    const usageId = stableUsageId('kb_index', model, batchKey ?? fingerprint(texts.join('\u0000')));
    const vectors = await this.call(orgId, model, [...texts], { usageId, label: INDEX_LABEL });
    return { vectors, model };
  }

  /**
   * The vector of one customer message, from the cache when the same text was seen lately. `usageId` names the customer message that
   * asked (a flow step, an inbound message id): the search of one message bills once. A caller with nothing stable passes none and the
   * search is billed under a fresh id.
   */
  async embedQuery(
    orgId: number,
    query: string,
    usageId?: string,
  ): Promise<{ vector: number[]; model: string; cached: boolean }> {
    const cfg = await this.config.get();
    const model = cfg.embeddingModel;
    const key = `kb:q:${model}:${createHash('sha256').update(query.toLowerCase()).digest('hex')}`;
    try {
      const hit = await this.redis.getBuffer(key);
      if (hit && hit.length > 0 && hit.length % 4 === 0) {
        const f = new Float32Array(hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.length));
        cache.hit();
        return { vector: Array.from(f), model, cached: true };
      }
    } catch {
      cache.error();
      // A cache that is down is a cache miss.
    }
    cache.miss();
    const [vector] = await this.call(orgId, model, [query], {
      usageId: stableUsageId('kb_query', usageId ?? randomUUID()),
      label: SEARCH_LABEL,
    });
    try {
      const buf = Buffer.from(new Float32Array(vector!).buffer);
      await this.redis.set(key, buf, 'EX', QUERY_CACHE_TTL_S);
    } catch {
      // Not caching is fine.
    }
    return { vector: vector!, model, cached: false };
  }

  private async call(
    orgId: number,
    model: string,
    inputs: string[],
    bill: Billing,
  ): Promise<number[][]> {
    const dims = this.config.dimensionsOf(model);
    if (dims === null)
      throw new KbUnavailableError(
        'provider',
        'The embedding model is not on the platform allow-list.',
      );
    const resolved = await this.keys.resolve(orgId, AI_PROVIDER);
    if (!resolved.key || resolved.source === 'none') {
      throw new KbUnavailableError(
        'no_key',
        'No OpenRouter key is set up for this workspace. Add one under AI keys, or ask your platform admin to enable the shared key.',
      );
    }
    if (resolved.source === 'admin') {
      try {
        await this.meter.guard(orgId);
      } catch {
        throw new KbUnavailableError('allowance', "This month's AI allowance is used up.");
      }
    }
    // Before the vendor, so an empty wallet cannot spend the platform's money. Only the platform's key is asked about.
    try {
      await this.charge.guardCall(orgId, resolved.source);
    } catch (err) {
      if (isWalletEmpty(err)) {
        throw new KbUnavailableError(
          'wallet',
          'Your wallet balance is empty. Top up to keep your knowledge base searchable.',
        );
      }
      throw err;
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
        .catch((err) => this.logger.warn({ orgId, err }, 'kb embedding usage not recorded'));
      // Never throws, and does nothing for a workspace on its own key: the vectors are already in hand.
      await this.charge.chargeCall({
        orgId,
        keySource: resolved.source,
        label: bill.label,
        source: USAGE_SOURCE,
        usageId: bill.usageId,
        provider: AI_PROVIDER,
        model,
        // A vendor that answered without a token count is priced from the text (4 characters a token), not given away.
        promptTokens:
          out.promptTokens > 0
            ? out.promptTokens
            : Math.ceil(inputs.reduce((n, t) => n + t.length, 0) / 4),
        completionTokens: 0,
        reportedCostUsd: out.costUsd,
      });
      return out.vectors.map(normalise);
    } catch (err) {
      if (err instanceof KbAiError) {
        throw new KbUnavailableError(
          err.kind === 'dimension_mismatch' ? 'bad_response' : err.kind,
          err.message,
        );
      }
      throw err;
    }
  }
}
