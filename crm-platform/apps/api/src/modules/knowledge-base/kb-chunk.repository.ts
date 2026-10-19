import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { MAX_EMBED_ATTEMPTS, type ScoredPassage } from './kb.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);

export interface SourceToIndex {
  id: number;
  assistantId: number;
  kind: string;
  content: string | null;
  question: string | null;
  answer: string | null;
}

export interface PlainSource {
  label: string;
  kind: string;
  content: string | null;
  question: string | null;
  answer: string | null;
}

/** The passages of the knowledge entries and their embedding queue. Every method runs inside the caller's transaction. */
@Injectable()
export class KbChunkRepository {
  // --- writing passages ---------------------------------------------------------------------------------------------

  /** Replaces an entry's passages (an edit or a first index). New rows wait for the embed worker. */
  async replaceForSource(
    tx: Tx,
    orgId: number,
    sourceId: number,
    assistantId: number,
    texts: readonly string[],
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM ai_training_chunks WHERE org_id = ${orgId} AND source_id = ${sourceId}`,
    );
    for (let i = 0; i < texts.length; i++) {
      await tx.execute(sql`
        INSERT INTO ai_training_chunks (org_id, source_id, assistant_id, position, text)
        VALUES (${orgId}, ${sourceId}, ${assistantId}, ${i}, ${texts[i]!})`);
    }
  }

  async sourceToIndex(tx: Tx, orgId: number, sourceId: number): Promise<SourceToIndex | null> {
    const res = await tx.execute(sql`
      SELECT id, assistant_id, kind, content, question, answer FROM ai_training_sources
      WHERE org_id = ${orgId} AND id = ${sourceId} AND status = 'ready' AND assistant_id IS NOT NULL`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      id: num(r.id),
      assistantId: num(r.assistant_id),
      kind: r.kind as string,
      content: (r.content as string | null) ?? null,
      question: (r.question as string | null) ?? null,
      answer: (r.answer as string | null) ?? null,
    };
  }

  /** Ready entries that have no passages yet (entries from before the index existed, the FAQ merge, a missed event). Privileged. */
  async unindexed(tx: Tx, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT s.org_id, s.id FROM ai_training_sources s
      WHERE s.status = 'ready' AND s.assistant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ai_training_chunks c WHERE c.org_id = s.org_id AND c.source_id = s.id)
        AND (coalesce(btrim(s.content), '') <> '' OR coalesce(btrim(s.question), '') <> '')
      ORDER BY s.id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ orgId: num(r.org_id), id: num(r.id) }));
  }

  // --- the embedding queue (worker) ---------------------------------------------------------------------------------

  /** Workspaces with work to do. Runs privileged: the list of ids is not tenant data. */
  async orgsWithPending(tx: Tx, limit: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT org_id FROM ai_training_chunks
      WHERE embed_state = 'pending' AND embed_attempts < ${MAX_EMBED_ATTEMPTS}
      ORDER BY org_id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => num(r.org_id));
  }

  /** Takes a batch and counts the attempt; `SKIP LOCKED` so two workers never take the same row. */
  async claim(tx: Tx, orgId: number, limit: number): Promise<Array<{ id: number; text: string }>> {
    const res = await tx.execute(sql`
      UPDATE ai_training_chunks SET embed_attempts = embed_attempts + 1
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM ai_training_chunks
        WHERE org_id = ${orgId} AND embed_state = 'pending' AND embed_attempts < ${MAX_EMBED_ATTEMPTS}
        ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, text`);
    return (res.rows as Raw[]).map((r) => ({ id: num(r.id), text: r.text as string }));
  }

  /** Stores the vector only when the text is still what was embedded (an edit meanwhile leaves the row pending). */
  async markReady(
    tx: Tx,
    orgId: number,
    id: number,
    atText: string,
    literal: string,
    model: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE ai_training_chunks
      SET embed_state = 'ready', embedding = ${literal}::halfvec, embedding_model = ${model}, embedded_at = now(),
          embed_attempts = 0, embed_error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND text = ${atText} AND embed_state = 'pending'
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Records why a batch failed; a row out of attempts becomes `failed` (the search reads its text directly meanwhile). */
  async markAttemptFailed(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    error: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE ai_training_chunks
      SET embed_error = ${error}, embed_state = CASE WHEN embed_attempts >= ${MAX_EMBED_ATTEMPTS} THEN 'failed' ELSE embed_state END
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) AND embed_state = 'pending'`);
  }

  /**
   * Puts back in the queue every vector that belongs to another model than the current one, and every row that gave up, so indexing
   * passes by default without anyone pressing Retry. Privileged. Returns how many.
   */
  async markStale(tx: Tx, currentModel: string): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE ai_training_chunks SET embed_state = 'pending', embed_attempts = 0, embed_error = NULL
      WHERE (embed_state = 'ready' AND embedding_model IS DISTINCT FROM ${currentModel}) OR embed_state = 'failed'
      RETURNING id`);
    return res.rows.length;
  }

  // --- reading for an answer ----------------------------------------------------------------------------------------

  /** How many passages of this agent are searchable now (vector made with the current model). */
  async readyCount(tx: Tx, orgId: number, assistantId: number, model: string): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM ai_training_chunks
      WHERE org_id = ${orgId} AND assistant_id = ${assistantId} AND embed_state = 'ready' AND embedding_model = ${model}`);
    return num((res.rows[0] as Raw).n);
  }

  /** The nearest passages to a message, best first (exact scan on the agent's own passages). */
  async nearest(
    tx: Tx,
    orgId: number,
    assistantId: number,
    literal: string,
    model: string,
    limit: number,
  ): Promise<ScoredPassage[]> {
    const res = await tx.execute(sql`
      SELECT s.label, c.text, 1 - (c.embedding <=> ${literal}::halfvec) AS score
      FROM ai_training_chunks c
      JOIN ai_training_sources s ON s.org_id = c.org_id AND s.id = c.source_id
      WHERE c.org_id = ${orgId} AND c.assistant_id = ${assistantId} AND c.embed_state = 'ready' AND c.embedding_model = ${model}
        AND s.status = 'ready'
      ORDER BY c.embedding <=> ${literal}::halfvec
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      label: r.label as string,
      text: r.text as string,
      score: num(r.score),
    }));
  }

  /**
   * Passages the vectors do not cover yet (queued, failed, or made with an older model), in reading order. They are read as text so a
   * new entry answers at once and an outage of the embedding vendor does not hide knowledge.
   */
  async unindexedPassages(
    tx: Tx,
    orgId: number,
    assistantId: number,
    model: string,
  ): Promise<Array<{ label: string; text: string }>> {
    const res = await tx.execute(sql`
      SELECT s.label, c.text FROM ai_training_chunks c
      JOIN ai_training_sources s ON s.org_id = c.org_id AND s.id = c.source_id
      WHERE c.org_id = ${orgId} AND c.assistant_id = ${assistantId} AND s.status = 'ready'
        AND NOT (c.embed_state = 'ready' AND c.embedding_model = ${model})
      ORDER BY c.source_id, c.position`);
    return (res.rows as Raw[]).map((r) => ({ label: r.label as string, text: r.text as string }));
  }

  /** Every ready entry of the agent, whole: what the agent read before the search existed, and still reads when the search is off. */
  async wholeBase(tx: Tx, orgId: number, assistantId: number): Promise<PlainSource[]> {
    const res = await tx.execute(sql`
      SELECT label, kind, content, question, answer FROM ai_training_sources
      WHERE org_id = ${orgId} AND assistant_id = ${assistantId} AND status = 'ready'
      ORDER BY id`);
    return res.rows as unknown as PlainSource[];
  }
}
