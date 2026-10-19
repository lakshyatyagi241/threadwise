import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { KbChunkRepository } from './kb-chunk.repository';
import { KbConfigService } from './kb-config.service';
import { KbEmbeddingService, KbUnavailableError } from './kb-embedding.service';
import { KbIndexService } from './kb-index.service';
import { MAX_EMBED_ATTEMPTS, toVectorLiteral } from './kb.rules';

const ORGS_PER_TICK = 10;
const BATCH = 64;
const BATCHES_PER_ORG = 4;
const LOCK_S = 90;
const HOUSEKEEPING_EVERY_TICKS = 12;
const INDEX_PER_PASS = 50;

/**
 * Makes the vectors (worker process). Every few seconds it finds workspaces with `pending` passages and embeds a batch for each:
 * a save never waits for the vendor, and a vendor outage only delays indexing (the agent reads the unindexed text directly meanwhile).
 *
 * - A row is claimed with `FOR UPDATE SKIP LOCKED` and its attempt counted; the vendor is called with no transaction open.
 * - A Redis lock per workspace keeps two worker pods from embedding the same workspace at once.
 * - The vector is stored only if the text is still what was embedded.
 * - About once a minute: entries that have no passages yet are cut (entries from before the index, the FAQ merge), vectors made with
 *   a model that is no longer the current one are re-queued, and rows that gave up get a fresh start. Nothing to press.
 */
@Injectable()
export class KbEmbedWorker {
  private readonly logger = new Logger(KbEmbedWorker.name);
  private running = false;
  private ticks = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: KbChunkRepository,
    private readonly index: KbIndexService,
    private readonly embeddings: KbEmbeddingService,
    private readonly config: KbConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Interval(5000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (this.ticks++ % HOUSEKEEPING_EVERY_TICKS === 0) {
        await this.indexMissing();
        await this.healStale();
      }
      await this.runOnce();
    } catch (err) {
      this.logger.error({ err }, 'knowledge embed tick failed');
    } finally {
      this.running = false;
    }
  }

  /** Cuts the ready entries that have no passages yet. Returns how many entries were indexed. */
  async indexMissing(): Promise<number> {
    const todo = await this.db.privileged((tx) => this.repo.unindexed(tx, INDEX_PER_PASS));
    for (const s of todo) {
      await this.db.txAs({ orgId: s.orgId, userId: null }, (tx) =>
        this.index.indexSource(tx, s.orgId, s.id),
      );
    }
    if (todo.length > 0) this.logger.log({ n: todo.length }, 'knowledge entries indexed');
    return todo.length;
  }

  /** Re-queues vectors of an older model and rows that gave up. Returns how many. */
  async healStale(): Promise<number> {
    const { embeddingModel } = await this.config.getFresh();
    const n = await this.db.privileged((tx) => this.repo.markStale(tx, embeddingModel));
    if (n > 0) this.logger.log({ n, embeddingModel }, 'knowledge vectors re-queued');
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
    const lock = `kb:embed:lock:${orgId}`;
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
            err instanceof KbUnavailableError ? err.message : 'The embedding provider failed.';
          await this.db.txAs({ orgId, userId: null }, (tx) =>
            this.repo.markAttemptFailed(
              tx,
              orgId,
              batch.map((b) => b.id),
              reason.slice(0, 300),
            ),
          );
          if (!(err instanceof KbUnavailableError))
            this.logger.warn({ orgId, err }, 'knowledge embedding batch failed');
          // Out of attempts or no key: stop this workspace for the tick; the next tick continues.
          break;
        }
      }
    } finally {
      await this.redis.del(lock).catch(() => undefined);
    }
    if (stored > 0)
      this.logger.log(
        { orgId, stored, maxAttempts: MAX_EMBED_ATTEMPTS },
        'knowledge vectors stored',
      );
    return stored;
  }
}
