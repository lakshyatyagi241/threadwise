import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { FaqConfigService } from './faq-config.service';
import { FaqEmbeddingService, FaqUnavailableError } from './faq-embedding.service';
import { FaqRepository } from './faq.repository';
import { MAX_EMBED_ATTEMPTS, toVectorLiteral } from './faq.rules';

const ORGS_PER_TICK = 10;
const BATCH = 64;
const BATCHES_PER_ORG = 4;
const LOCK_S = 90;
const HEAL_EVERY_TICKS = 12;

/**
 * Makes the vectors (worker process). Every few seconds it finds workspaces with `pending` variations and embeds a batch for each:
 * a save never waits for the vendor, and a vendor outage only delays indexing (matching meanwhile uses spelling similarity).
 *
 * - A row is claimed with `FOR UPDATE SKIP LOCKED` and its attempt counted; the vendor is called with no transaction open.
 * - A Redis lock per workspace keeps two worker pods from embedding the same workspace at once.
 * - The vector is stored only if the text is still what was embedded; an edit meanwhile leaves the row pending for the next tick.
 * - After MAX_EMBED_ATTEMPTS the row is `failed`; the screens show it with a Retry (and the reason, never the vendor's body).
 */
@Injectable()
export class FaqEmbedWorker {
  private readonly logger = new Logger(FaqEmbedWorker.name);
  private running = false;
  private ticks = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: FaqRepository,
    private readonly embeddings: FaqEmbeddingService,
    private readonly config: FaqConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Interval(5000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // About once a minute: re-queue vectors made with a model that is no longer the current one (a switch can race a batch that was
      // already being embedded). Cheap when there are none; the platform's own model change queues them at once.
      if (this.ticks++ % HEAL_EVERY_TICKS === 0) await this.healStale();
      await this.runOnce();
    } catch (err) {
      this.logger.error({ err }, 'faq embed tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Puts back in the queue every ready vector that belongs to another model than the current one. Returns how many. */
  async healStale(): Promise<number> {
    const { embeddingModel } = await this.config.getFresh();
    const n = await this.db.privileged((tx) => this.repo.markStale(tx, embeddingModel, false));
    if (n > 0) this.logger.log({ n, embeddingModel }, 'faq vectors of an older model re-queued');
    return n;
  }

  /** One pass over the workspaces that have work. Returns how many vectors were stored (the tests call this directly). */
  async runOnce(): Promise<number> {
    const orgs = await this.db.privileged((tx) => this.repo.orgsWithPending(tx, ORGS_PER_TICK));
    let stored = 0;
    for (const orgId of orgs) stored += await this.embedOrg(orgId);
    return stored;
  }

  private async embedOrg(orgId: number): Promise<number> {
    const lock = `faq:embed:lock:${orgId}`;
    try {
      if ((await this.redis.set(lock, '1', 'EX', LOCK_S, 'NX')) !== 'OK') return 0;
    } catch {
      return 0;
    }
    let stored = 0;
    try {
      for (let i = 0; i < BATCHES_PER_ORG; i++) {
        const batch = await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.repo.claim(tx, orgId, BATCH),
        );
        if (batch.length === 0) break;
        try {
          const { vectors, model } = await this.embeddings.embedMany(
            orgId,
            batch.map((b) => b.text),
          );
          await this.db.txAs({ orgId, userId: null }, async (tx) => {
            for (let k = 0; k < batch.length; k++) {
              if (
                await this.repo.markReady(
                  tx,
                  orgId,
                  batch[k]!.id,
                  batch[k]!.text,
                  toVectorLiteral(vectors[k]!),
                  model,
                )
              ) {
                stored++;
              }
            }
          });
        } catch (err) {
          const reason =
            err instanceof FaqUnavailableError ? err.message : 'The embedding provider failed.';
          await this.db.txAs({ orgId, userId: null }, (tx) =>
            this.repo.markAttemptFailed(
              tx,
              orgId,
              batch.map((b) => b.id),
              reason.slice(0, 300),
            ),
          );
          if (!(err instanceof FaqUnavailableError))
            this.logger.warn({ orgId, err }, 'faq embedding batch failed');
          // Out of attempts or no key: stop this workspace for the tick; the next tick (or a retry) continues.
          break;
        }
      }
    } finally {
      await this.redis.del(lock).catch(() => undefined);
    }
    if (stored > 0)
      this.logger.log({ orgId, stored, maxAttempts: MAX_EMBED_ATTEMPTS }, 'faq vectors stored');
    return stored;
  }
}
