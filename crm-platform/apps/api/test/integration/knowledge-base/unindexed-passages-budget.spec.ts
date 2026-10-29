import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';
import type { Tx } from '@crm/db';
import { KbChunkRepository } from '../../../src/modules/knowledge-base/kb-chunk.repository';
import { UNINDEXED_BUDGET_CHARS } from '../../../src/modules/knowledge-base/kb.rules';

/**
 * A customer message reads the passages the vectors do not cover yet, up to UNINDEXED_BUDGET_CHARS characters. Before the budget
 * reached the query, every unembedded passage of the agent was read on every message and most were thrown away in JS.
 *
 * Proves two things against a real Postgres: the query returns only the passages the budget can use, and the passages it returns
 * are the same ones, in the same order, that a loop over the full list would use.
 */
describe('unindexed passages are read up to the search budget', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let db: ReturnType<typeof drizzle>;
  let orgId: number;
  let assistantId: number;
  const repo = new KbChunkRepository();
  const model = 'test-model';
  const passages = 2000;

  /** The loop in KbRetrieval.search, over whatever list it is given. */
  const takeWithinBudget = (rows: Array<{ label: string; text: string }>): string[] => {
    const out: string[] = [];
    let budget = UNINDEXED_BUDGET_CHARS;
    for (const u of rows) {
      if (budget <= 0) break;
      out.push(u.text.slice(0, budget));
      budget -= u.text.length;
    }
    return out;
  };

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
      `INSERT INTO organizations (slug, name) VALUES ('kb-budget', 'KB budget') RETURNING id`,
    );
    orgId = Number(org.rows[0]!.id);
    const asst = await owner.query<{ id: number }>(
      `INSERT INTO ai_chat_assistants (org_id, name, slug) VALUES ($1, 'Bot', 'bot') RETURNING id`,
      [orgId],
    );
    assistantId = Number(asst.rows[0]!.id);
    const src = await owner.query<{ id: number }>(
      `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status)
       VALUES ($1, $2, 'text', 'Big entry', 'x', 'ready') RETURNING id`,
      [orgId, assistantId],
    );
    const sourceId = Number(src.rows[0]!.id);
    // Each passage is about 100 characters, so the budget fills after about 60 of them.
    await owner.query(
      `INSERT INTO ai_training_chunks (org_id, source_id, assistant_id, position, text)
       SELECT $1, $2, $3, g, 'p' || g || ' ' || repeat('x', 95) FROM generate_series(0, $4 - 1) AS g`,
      [orgId, sourceId, assistantId, passages],
    );
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('returns only the rows the budget can use, and the same ones a loop over the full list would use', async () => {
    const limited = await repo.unindexedPassages(
      db as unknown as Tx,
      orgId,
      assistantId,
      model,
      UNINDEXED_BUDGET_CHARS,
    );

    const full = (
      await owner.query<{ label: string; text: string }>(
        `SELECT s.label, c.text FROM ai_training_chunks c
         JOIN ai_training_sources s ON s.org_id = c.org_id AND s.id = c.source_id
         WHERE c.org_id = $1 AND c.assistant_id = $2 AND s.status = 'ready'
           AND NOT (c.embed_state = 'ready' AND c.embedding_model = $3)
         ORDER BY c.source_id, c.position`,
        [orgId, assistantId, model],
      )
    ).rows;
    expect(full).toHaveLength(passages);

    expect(limited.length).toBeLessThanOrEqual(Math.ceil(UNINDEXED_BUDGET_CHARS / 100) + 1);
    expect(takeWithinBudget(limited)).toEqual(takeWithinBudget(full));
  });
});
