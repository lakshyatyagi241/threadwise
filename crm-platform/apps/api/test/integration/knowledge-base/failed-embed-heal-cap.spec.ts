import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import type { Tx } from '@crm/db';
import { KbChunkRepository } from '../../../src/modules/knowledge-base/kb-chunk.repository';
import { MAX_EMBED_ATTEMPTS, MAX_FAILED_HEALS } from '../../../src/modules/knowledge-base/kb.rules';

/**
 * A passage the embedding vendor always refuses must stop costing vendor calls. The housekeeping re-queues `failed` rows once a
 * minute; before the cap it did so forever, and every re-queue gave the row MAX_EMBED_ATTEMPTS new vendor calls.
 *
 * Runs the real repository methods (claim, markAttemptFailed, markStale) against a real Postgres, the same way the worker calls them,
 * with a vendor that always fails: it counts the calls.
 */
describe('failed embedding rows stop being re-queued after MAX_FAILED_HEALS', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let db: ReturnType<typeof drizzle>;
  let chunkId: number;
  let orgId: number;
  const repo = new KbChunkRepository();

  /** One worker pass for this passage: claim a batch and fail it, as the embed worker does when the vendor refuses. */
  const vendorRefuses = async (): Promise<number> => {
    let calls = 0;
    // The worker claims while attempts < MAX_EMBED_ATTEMPTS; each claim is one vendor call that fails.
    for (;;) {
      const batch = await repo.claim(db as unknown as Tx, orgId, 64);
      if (batch.length === 0) break;
      calls++;
      await repo.markAttemptFailed(db as unknown as Tx, orgId, [chunkId], 'provider refused');
    }
    return calls;
  };

  const state = async () =>
    (
      await owner.query<{ embed_state: string; embed_heal_count: number; embed_attempts: number }>(
        `SELECT embed_state, embed_heal_count, embed_attempts FROM ai_training_chunks WHERE id = $1`,
        [chunkId],
      )
    ).rows[0]!;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), {
      dir: resolve(__dirname, '../../../../../packages/db/migrations'),
      log: () => undefined,
    });
    db = drizzle(owner);

    const org = await owner.query<{ id: number }>(
      `INSERT INTO organizations (slug, name) VALUES ('kb-heal', 'KB heal') RETURNING id`,
    );
    orgId = Number(org.rows[0]!.id);
    const asst = await owner.query<{ id: number }>(
      `INSERT INTO ai_chat_assistants (org_id, name, slug) VALUES ($1, 'Bot', 'bot') RETURNING id`,
      [orgId],
    );
    const src = await owner.query<{ id: number }>(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status)
       VALUES ($1, $2, 'text', 'Refused entry', 'x', 'ready') RETURNING id`,
      [orgId, asst.rows[0]!.id],
    );
    const chunk = await owner.query<{ id: number }>(
      `INSERT INTO ai_training_chunks (org_id, source_id, assistant_id, position, text)
       VALUES ($1, $2, $3, 0, 'a passage the vendor refuses') RETURNING id`,
      [orgId, src.rows[0]!.id, asst.rows[0]!.id],
    );
    chunkId = Number(chunk.rows[0]!.id);
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('re-queues a failed row at most MAX_FAILED_HEALS times, then leaves it failed', async () => {
    let vendorCalls = 0;
    // First pass: the row runs out of attempts and becomes failed.
    vendorCalls += await vendorRefuses();
    expect(await state()).toMatchObject({
      embed_state: 'failed',
      embed_attempts: MAX_EMBED_ATTEMPTS,
    });

    // Many housekeeping cycles (about a minute each in production). Each one re-queues the row only while it has heals left.
    let heals = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      const requeued = await repo.markStale(db as unknown as Tx, 'model-x');
      if (requeued > 0) {
        heals++;
        vendorCalls += await vendorRefuses();
      }
    }

    expect(heals).toBe(MAX_FAILED_HEALS);
    expect(vendorCalls).toBe(MAX_EMBED_ATTEMPTS * (MAX_FAILED_HEALS + 1));
    expect(await state()).toMatchObject({
      embed_state: 'failed',
      embed_heal_count: MAX_FAILED_HEALS,
    });
  });

  it('a failed row past the cap is not touched by later housekeeping', async () => {
    expect(await repo.markStale(db as unknown as Tx, 'model-x')).toBe(0);
    expect(await state()).toMatchObject({
      embed_state: 'failed',
      embed_heal_count: MAX_FAILED_HEALS,
    });
  });

  it('an edit of the entry (new rows) gives the passage a fresh start', async () => {
    // An edit of the entry runs replaceForSource: the old rows are deleted and new ones written.
    const s = await owner.query<{ id: number; assistant_id: number }>(
      `SELECT id, assistant_id FROM ai_training_sources WHERE org_id = $1 LIMIT 1`,
      [orgId],
    );
    const sourceId = Number(s.rows[0]!.id);
    await repo.replaceForSource(
      db as unknown as Tx,
      orgId,
      sourceId,
      Number(s.rows[0]!.assistant_id),
      ['a passage the vendor refuses'],
    );
    const fresh = await owner.query<{ id: number }>(
      `SELECT id FROM ai_training_chunks WHERE org_id = $1 AND source_id = $2`,
      [orgId, sourceId],
    );
    chunkId = Number(fresh.rows[0]!.id);
    expect(await state()).toMatchObject({ embed_state: 'pending', embed_heal_count: 0 });
  });
});
