import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { MAX_EMBED_ATTEMPTS, VECTOR_FETCH, type FlowBinding, type Scored } from './faq.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date => new Date(v as string);
const dateOrNull = (v: unknown): Date | null => (v === null || v === undefined ? null : date(v));

export interface EntryRow {
  id: number;
  uuid: string;
  question: string;
  answerType: string;
  answerText: string | null;
  flowId: number | null;
  flowUuid: string | null;
  flowName: string | null;
  flowNodeId: string | null;
  flowNodeLabel: string | null;
  category: string | null;
  status: string;
  thresholdOverride: number | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  variationCount: number;
  readyCount: number;
  failedCount: number;
  hitCount: number;
  lastHitAt: Date | null;
}

export interface EntryWrite {
  /** The flow the FAQ belongs to (internal id); never changed by an update. */
  ownerFlowId: number;
  question: string;
  answerType: string;
  answerText: string | null;
  flowId: number | null;
  flowNodeId: string | null;
  category: string | null;
  status: string;
  thresholdOverride: number | null;
}

export interface VariationRow {
  id: number;
  uuid: string;
  faqId: number;
  text: string;
  source: string;
  embedState: string;
  embedError: string | null;
  createdAt: Date;
  rowVersion: number;
}

export interface ListFilter {
  limit: number;
  afterId: number | null;
  search?: string;
  status?: string;
  category?: string;
  indexing?: 'pending' | 'failed';
  /** Vectors of this model count as indexed; others count as waiting. */
  model: string;
}

export interface FaqStatsRow {
  total: number;
  active: number;
  paused: number;
  variations: number;
  pending: number;
  failed: number;
  categories: string[];
}

const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** `faqs`, `faq_variations` and the matcher's reads, tenant-scoped through the caller's transaction (RLS) and again by `org_id`. */
@Injectable()
export class FaqRepository {
  // --- entries ------------------------------------------------------------------------------------------------------

  private cols(): SQL {
    return sql`
      f.id, f.uuid, f.question, f.answer_type, f.answer_text, f.flow_id, f.flow_node_id, fl.uuid AS flow_uuid, fl.flow_name,
      (SELECT coalesce(nullif(btrim(n->'data'->>'label'), ''), nullif(btrim(n->'data'->>'name'), ''), n->>'type')
         FROM jsonb_array_elements(coalesce(fl.flow_data->'flowNodes', '[]'::jsonb)) n
         WHERE n->>'id' = f.flow_node_id LIMIT 1) AS flow_node_label,
      f.category, f.status, f.threshold_override, f.created_at, f.updated_at, f.row_version,
      vc.total AS variation_count, vc.ready AS ready_count, vc.failed AS failed_count,
      h.hits AS hit_count, h.last_hit AS last_hit_at`;
  }

  private joins(model: string): SQL {
    return sql`
      LEFT JOIN flows fl ON fl.org_id = f.org_id AND fl.id = f.flow_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (WHERE v.embed_state = 'ready' AND v.embedding_model = ${model}) AS ready,
               count(*) FILTER (WHERE v.embed_state = 'failed') AS failed
        FROM faq_variations v WHERE v.org_id = f.org_id AND v.faq_id = f.id) vc ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS hits, max(l.created_at) AS last_hit
        FROM faq_match_logs l
        WHERE l.org_id = f.org_id AND l.matched_faq_id = f.id AND l.origin = 'inbound'
          AND l.outcome IN ('answered', 'flow_started')) h ON true`;
  }

  private toEntry(r: Raw): EntryRow {
    return {
      id: num(r.id),
      uuid: r.uuid as string,
      question: r.question as string,
      answerType: r.answer_type as string,
      answerText: text(r.answer_text),
      flowId: numOrNull(r.flow_id),
      flowUuid: text(r.flow_uuid),
      flowName: text(r.flow_name),
      flowNodeId: text(r.flow_node_id),
      flowNodeLabel: text(r.flow_node_label),
      category: text(r.category),
      status: r.status as string,
      thresholdOverride: numOrNull(r.threshold_override),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
      rowVersion: num(r.row_version),
      variationCount: num(r.variation_count),
      readyCount: num(r.ready_count),
      failedCount: num(r.failed_count),
      hitCount: num(r.hit_count),
      lastHitAt: dateOrNull(r.last_hit_at),
    };
  }

  async list(tx: Tx, orgId: number, flowId: number, f: ListFilter): Promise<EntryRow[]> {
    const where: SQL[] = [sql`f.org_id = ${orgId}`, sql`f.owner_flow_id = ${flowId}`];
    if (f.afterId !== null) where.push(sql`f.id < ${f.afterId}`);
    if (f.status) where.push(sql`f.status = ${f.status}`);
    if (f.category) where.push(sql`f.category = ${f.category}`);
    if (f.search) {
      const like = likeOf(f.search);
      where.push(sql`(f.question ILIKE ${like} OR EXISTS (
        SELECT 1 FROM faq_variations sv WHERE sv.org_id = f.org_id AND sv.faq_id = f.id AND sv.text ILIKE ${like}))`);
    }
    if (f.indexing === 'failed') {
      where.push(
        sql`EXISTS (SELECT 1 FROM faq_variations iv WHERE iv.org_id = f.org_id AND iv.faq_id = f.id AND iv.embed_state = 'failed')`,
      );
    } else if (f.indexing === 'pending') {
      where.push(sql`EXISTS (SELECT 1 FROM faq_variations iv WHERE iv.org_id = f.org_id AND iv.faq_id = f.id
        AND (iv.embed_state = 'pending' OR (iv.embed_state = 'ready' AND iv.embedding_model IS DISTINCT FROM ${f.model})))`);
    }
    const res = await tx.execute(sql`
      SELECT ${this.cols()} FROM faqs f ${this.joins(f.model)}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY f.id DESC
      LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map((r) => this.toEntry(r));
  }

  /** One FAQ of the flow's own; an FAQ that belongs to another flow reads as missing. */
  async findByUuid(
    tx: Tx,
    orgId: number,
    flowId: number,
    uuid: string,
    model: string,
  ): Promise<EntryRow | null> {
    const res = await tx.execute(sql`
      SELECT ${this.cols()} FROM faqs f ${this.joins(model)}
      WHERE f.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.uuid = ${uuid}`);
    const r = (res.rows as Raw[])[0];
    return r ? this.toEntry(r) : null;
  }

  async findById(tx: Tx, orgId: number, id: number, model: string): Promise<EntryRow | null> {
    const res = await tx.execute(sql`
      SELECT ${this.cols()} FROM faqs f ${this.joins(model)}
      WHERE f.org_id = ${orgId} AND f.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? this.toEntry(r) : null;
  }

  async stats(tx: Tx, orgId: number, flowId: number, model: string): Promise<FaqStatsRow> {
    const res = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId}) AS total,
        (SELECT count(*) FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND status = 'active') AS active,
        (SELECT count(*) FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND status = 'paused') AS paused,
        (SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
          WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId}) AS variations,
        (SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
          WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId}
          AND (v.embed_state = 'pending' OR (v.embed_state = 'ready' AND v.embedding_model IS DISTINCT FROM ${model}))) AS pending,
        (SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
          WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND v.embed_state = 'failed') AS failed,
        COALESCE((SELECT array_agg(DISTINCT category ORDER BY category) FROM faqs
          WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND category IS NOT NULL), '{}') AS categories`);
    const r = (res.rows as Raw[])[0]!;
    return {
      total: num(r.total),
      active: num(r.active),
      paused: num(r.paused),
      variations: num(r.variations),
      pending: num(r.pending),
      failed: num(r.failed),
      categories: (r.categories as string[]) ?? [],
    };
  }

  async questionTaken(
    tx: Tx,
    orgId: number,
    flowId: number,
    question: string,
    exceptId: number | null,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND lower(btrim(question)) = lower(btrim(${question}))
        AND (${exceptId}::bigint IS NULL OR id <> ${exceptId}::bigint) LIMIT 1`);
    return res.rows.length > 0;
  }

  async insertEntry(tx: Tx, orgId: number, userId: number | null, w: EntryWrite): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO faqs (org_id, owner_flow_id, question, answer_type, answer_text, flow_id, flow_node_id, category, status, threshold_override, created_by)
      VALUES (${orgId}, ${w.ownerFlowId}, ${w.question}, ${w.answerType}, ${w.answerText}, ${w.flowId}, ${w.flowNodeId}, ${w.category}, ${w.status},
              ${w.thresholdOverride}, ${userId})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /** The row version is asserted, never written (the touch_row trigger bumps it). False when someone saved first. */
  async updateEntry(
    tx: Tx,
    orgId: number,
    id: number,
    w: EntryWrite,
    rowVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE faqs SET question = ${w.question}, answer_type = ${w.answerType}, answer_text = ${w.answerText},
        flow_id = ${w.flowId}, flow_node_id = ${w.flowNodeId}, category = ${w.category}, status = ${w.status}, threshold_override = ${w.thresholdOverride}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** The FAQs of this flow among `uuids`; one that belongs to another flow is left out. */
  async idsByUuids(
    tx: Tx,
    orgId: number,
    flowId: number,
    uuids: readonly string[],
  ): Promise<Array<{ id: number; uuid: string; question: string }>> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT id, uuid, question FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return (res.rows as Raw[]).map((r) => ({
      id: num(r.id),
      uuid: r.uuid as string,
      question: r.question as string,
    }));
  }

  async deleteMany(tx: Tx, orgId: number, ids: readonly number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await tx.execute(sql`
      DELETE FROM faqs WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) RETURNING id`);
    return res.rows.length;
  }

  async setStatus(tx: Tx, orgId: number, ids: readonly number[], status: string): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await tx.execute(sql`
      UPDATE faqs SET status = ${status}
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) AND status <> ${status}
      RETURNING id`);
    return res.rows.length;
  }

  async flowByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | null> {
    const res = await tx.execute(
      sql`SELECT id, flow_name FROM flows WHERE org_id = ${orgId} AND uuid = ${uuid}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? { id: num(r.id), name: r.flow_name as string } : null;
  }

  /** The flow a `/flows/:flowId/...` route is about: 404 when it is not a flow of this workspace (RLS and the org filter both apply). */
  async requireFlow(tx: Tx, orgId: number, uuid: string): Promise<{ id: number; name: string }> {
    const flow = await this.flowByUuid(tx, orgId, uuid);
    if (!flow) throw AppError.notFound('Flow', uuid);
    return flow;
  }

  /** The steps of a flow, for the "start at" picker and to check a saved node still exists. */
  async flowNodes(
    tx: Tx,
    orgId: number,
    flowUuid: string,
  ): Promise<Array<{ id: string; type: string; label: string }> | null> {
    const res = await tx.execute(sql`
      SELECT n->>'id' AS id, n->>'type' AS type,
             coalesce(nullif(btrim(n->'data'->>'label'), ''), nullif(btrim(n->'data'->>'name'), ''), '') AS label
      FROM flows fl, jsonb_array_elements(coalesce(fl.flow_data->'flowNodes', '[]'::jsonb)) n
      WHERE fl.org_id = ${orgId} AND fl.uuid = ${flowUuid}::uuid AND coalesce(n->>'id', '') <> ''`);
    if (res.rows.length === 0) {
      const exists = await tx.execute(
        sql`SELECT 1 FROM flows WHERE org_id = ${orgId} AND uuid = ${flowUuid}::uuid`,
      );
      if (exists.rows.length === 0) return null;
    }
    return (res.rows as Raw[]).map((r) => ({
      id: r.id as string,
      type: (r.type as string | null) ?? '',
      label: (r.label as string | null) ?? '',
    }));
  }

  async countFaqs(tx: Tx, orgId: number, flowId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS n FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId}`,
    );
    return num((res.rows[0] as Raw).n);
  }

  /** What one flow holds, for the limits (they apply per flow). */
  async usage(
    tx: Tx,
    orgId: number,
    flowId: number,
  ): Promise<{ faqs: number; variations: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId}) AS faqs,
             (SELECT count(*) FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
               WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId}) AS variations`);
    const r = (res.rows as Raw[])[0]!;
    return { faqs: num(r.faqs), variations: num(r.variations) };
  }

  // --- variations ---------------------------------------------------------------------------------------------------

  private toVariation(r: Raw): VariationRow {
    return {
      id: num(r.id),
      uuid: r.uuid as string,
      faqId: num(r.faq_id),
      text: r.text as string,
      source: r.source as string,
      embedState: r.embed_state as string,
      embedError: text(r.embed_error),
      createdAt: date(r.created_at),
      rowVersion: num(r.row_version),
    };
  }

  /** The question first, then the rest oldest first. `ready` only counts for the current model. */
  async listVariations(
    tx: Tx,
    orgId: number,
    faqId: number,
    model: string,
  ): Promise<VariationRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, faq_id, text, source,
             CASE WHEN embed_state = 'ready' AND embedding_model IS DISTINCT FROM ${model} THEN 'pending' ELSE embed_state END AS embed_state,
             embed_error, created_at, row_version
      FROM faq_variations WHERE org_id = ${orgId} AND faq_id = ${faqId}
      ORDER BY (source = 'question') DESC, id ASC`);
    return (res.rows as Raw[]).map((r) => this.toVariation(r));
  }

  async variationCount(tx: Tx, orgId: number, faqId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS n FROM faq_variations WHERE org_id = ${orgId} AND faq_id = ${faqId}`,
    );
    return num((res.rows[0] as Raw).n);
  }

  /** Inserts the new ones and returns the rows that were created (a phrasing the FAQ already has is skipped). */
  async insertVariations(
    tx: Tx,
    orgId: number,
    faqId: number,
    texts: readonly string[],
    source: string,
  ): Promise<VariationRow[]> {
    if (texts.length === 0) return [];
    const rows = texts.map((t) => sql`(${orgId}, ${faqId}, ${t}, ${source})`);
    const res = await tx.execute(sql`
      INSERT INTO faq_variations (org_id, faq_id, text, source) VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT (org_id, faq_id, lower(btrim(text))) DO NOTHING
      RETURNING id, uuid, faq_id, text, source, embed_state, embed_error, created_at, row_version`);
    return (res.rows as Raw[]).map((r) => this.toVariation(r));
  }

  async findVariation(
    tx: Tx,
    orgId: number,
    faqId: number,
    uuid: string,
  ): Promise<VariationRow | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, faq_id, text, source, embed_state, embed_error, created_at, row_version
      FROM faq_variations WHERE org_id = ${orgId} AND faq_id = ${faqId} AND uuid = ${uuid}`);
    const r = (res.rows as Raw[])[0];
    return r ? this.toVariation(r) : null;
  }

  /** New text means a new vector: the old one is dropped and the row waits for the worker. */
  async updateVariationText(
    tx: Tx,
    orgId: number,
    id: number,
    newText: string,
    rowVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE faq_variations
      SET text = ${newText}, embed_state = 'pending', embedding = NULL, embedding_model = NULL, embedded_at = NULL,
          embed_attempts = 0, embed_error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async deleteVariation(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM faq_variations WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Keeps the FAQ's own question present as a variation (source `question`), so a match needs one table. A renamed question replaces
   * the text and drops the vector; another variation that already says the same thing is removed rather than duplicated.
   */
  async syncQuestionVariation(
    tx: Tx,
    orgId: number,
    faqId: number,
    question: string,
  ): Promise<void> {
    await tx.execute(sql`
      DELETE FROM faq_variations
      WHERE org_id = ${orgId} AND faq_id = ${faqId} AND source <> 'question' AND lower(btrim(text)) = lower(btrim(${question}))`);
    const upd = await tx.execute(sql`
      UPDATE faq_variations
      SET text = ${question}, embed_state = 'pending', embedding = NULL, embedding_model = NULL, embedded_at = NULL,
          embed_attempts = 0, embed_error = NULL
      WHERE org_id = ${orgId} AND faq_id = ${faqId} AND source = 'question' AND text <> ${question}
      RETURNING id`);
    if (upd.rows.length > 0) return;
    await tx.execute(sql`
      INSERT INTO faq_variations (org_id, faq_id, text, source)
      SELECT ${orgId}, ${faqId}, ${question}, 'question'
      WHERE NOT EXISTS (SELECT 1 FROM faq_variations WHERE org_id = ${orgId} AND faq_id = ${faqId} AND source = 'question')
      ON CONFLICT (org_id, faq_id, lower(btrim(text))) DO NOTHING`);
  }

  // --- the embedding queue (worker) ---------------------------------------------------------------------------------

  /** Workspaces with work to do. Runs privileged: the list of ids is not tenant data. */
  async orgsWithPending(tx: Tx, limit: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT org_id FROM faq_variations WHERE embed_state = 'pending' AND embed_attempts < ${MAX_EMBED_ATTEMPTS}
      ORDER BY org_id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => num(r.org_id));
  }

  /** Takes a batch and counts the attempt; `SKIP LOCKED` so two workers never take the same row. */
  async claim(tx: Tx, orgId: number, limit: number): Promise<Array<{ id: number; text: string }>> {
    const res = await tx.execute(sql`
      UPDATE faq_variations SET embed_attempts = embed_attempts + 1
      WHERE (org_id, id) IN (
        SELECT org_id, id FROM faq_variations
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
      UPDATE faq_variations
      SET embed_state = 'ready', embedding = ${literal}::halfvec, embedding_model = ${model}, embedded_at = now(),
          embed_attempts = 0, embed_error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND text = ${atText} AND embed_state = 'pending'
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Records why a batch failed; a row out of attempts becomes `failed` (the screen shows it with a retry). */
  async markAttemptFailed(
    tx: Tx,
    orgId: number,
    ids: readonly number[],
    error: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE faq_variations
      SET embed_error = ${error}, embed_state = CASE WHEN embed_attempts >= ${MAX_EMBED_ATTEMPTS} THEN 'failed' ELSE embed_state END
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) AND embed_state = 'pending'`);
  }

  /** Retry of the rows that gave up: back to pending with fresh attempts. Returns how many. */
  async retryFailed(tx: Tx, orgId: number | null): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE faq_variations SET embed_state = 'pending', embed_attempts = 0, embed_error = NULL
      WHERE embed_state = 'failed' AND (${orgId}::bigint IS NULL OR org_id = ${orgId}::bigint)
      RETURNING id`);
    return res.rows.length;
  }

  /**
   * A model change: every vector that belongs to another model waits to be re-made. Privileged. `includeFailed` also gives the rows that
   * gave up a fresh start (an operator changing the model); the worker's own self-heal pass leaves them alone.
   */
  async markStale(tx: Tx, currentModel: string, includeFailed = true): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE faq_variations SET embed_state = 'pending', embed_attempts = 0, embed_error = NULL
      WHERE (embed_state = 'ready' AND embedding_model IS DISTINCT FROM ${currentModel})
         OR (${includeFailed} AND embed_state = 'failed')
      RETURNING id`);
    return res.rows.length;
  }

  /** Everything re-embedded with the current model, on request. Privileged. */
  async markAllPending(tx: Tx): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE faq_variations SET embed_state = 'pending', embed_attempts = 0, embed_error = NULL RETURNING id`);
    return res.rows.length;
  }

  // --- matching reads -----------------------------------------------------------------------------------------------

  private toScored(r: Raw): Scored {
    return {
      faqId: num(r.faq_id),
      faqUuid: r.faq_uuid as string,
      question: r.question as string,
      status: r.status as 'active' | 'paused',
      thresholdOverride: numOrNull(r.threshold_override),
      text: r.text as string,
      score: num(r.score),
    };
  }

  async activeFaqCount(tx: Tx, orgId: number, flowId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS n FROM faqs WHERE org_id = ${orgId} AND owner_flow_id = ${flowId} AND status = 'active'`,
    );
    return num((res.rows[0] as Raw).n);
  }

  async readyVariationCount(tx: Tx, orgId: number, flowId: number, model: string): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
      WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.status = 'active' AND v.embed_state = 'ready' AND v.embedding_model = ${model}`);
    return num((res.rows[0] as Raw).n);
  }

  /** The customer typed one of the phrasings (or the question) word for word, ignoring case and spacing. */
  async exact(
    tx: Tx,
    orgId: number,
    flowId: number,
    query: string,
    category: string | null = null,
  ): Promise<Scored[]> {
    const res = await tx.execute(sql`
      SELECT f.id AS faq_id, f.uuid AS faq_uuid, f.question, f.status, f.threshold_override, v.text, 1.0 AS score
      FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
      WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.status = 'active' AND lower(btrim(v.text)) = lower(btrim(${query}))
        AND (${category}::text IS NULL OR f.category = ${category}::text)
      ORDER BY f.id LIMIT 5`);
    return (res.rows as Raw[]).map((r) => this.toScored(r));
  }

  /** Exact cosine scan of this flow's vectors for the current model (ADR-0021: no ANN index). Score = 1 - cosine distance. */
  async vector(
    tx: Tx,
    orgId: number,
    flowId: number,
    model: string,
    literal: string,
    category: string | null = null,
  ): Promise<Scored[]> {
    const res = await tx.execute(sql`
      SELECT f.id AS faq_id, f.uuid AS faq_uuid, f.question, f.status, f.threshold_override, v.text,
             1 - (v.embedding <=> ${literal}::halfvec) AS score
      FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
      WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.status = 'active' AND v.embed_state = 'ready' AND v.embedding_model = ${model}
        AND (${category}::text IS NULL OR f.category = ${category}::text)
      ORDER BY v.embedding <=> ${literal}::halfvec
      LIMIT ${VECTOR_FETCH}`);
    return (res.rows as Raw[]).map((r) => this.toScored(r));
  }

  /** The fallback when no vector is available: spelling similarity over every variation of an active FAQ. */
  async trigram(
    tx: Tx,
    orgId: number,
    flowId: number,
    query: string,
    category: string | null = null,
  ): Promise<Scored[]> {
    const res = await tx.execute(sql`
      SELECT f.id AS faq_id, f.uuid AS faq_uuid, f.question, f.status, f.threshold_override, v.text,
             similarity(lower(v.text), lower(${query})) AS score
      FROM faq_variations v JOIN faqs f ON f.org_id = v.org_id AND f.id = v.faq_id
      WHERE v.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.status = 'active' AND similarity(lower(v.text), lower(${query})) >= 0.3
        AND (${category}::text IS NULL OR f.category = ${category}::text)
      ORDER BY score DESC LIMIT ${VECTOR_FETCH}`);
    return (res.rows as Raw[]).map((r) => this.toScored(r));
  }

  /**
   * The flows that could answer a customer message: published and active, FAQ answering switched on in their own settings, and at
   * least one active FAQ. The channel test is done by `candidateFlows` in faq.rules (the keyword trigger's own predicate).
   */
  async answeringFlows(tx: Tx, orgId: number): Promise<FlowBinding[]> {
    const res = await tx.execute(sql`
      SELECT fl.id, fl.trigger_channel_id, fl.provider
      FROM flows fl
      JOIN faq_settings s ON s.org_id = fl.org_id AND s.flow_id = fl.id AND s.enabled
      WHERE fl.org_id = ${orgId} AND fl.is_published AND fl.is_active
        AND EXISTS (SELECT 1 FROM faqs f WHERE f.org_id = fl.org_id AND f.owner_flow_id = fl.id AND f.status = 'active')
      ORDER BY fl.id`);
    return (res.rows as Raw[]).map((r) => ({
      id: num(r.id),
      triggerChannelId: numOrNull(r.trigger_channel_id),
      provider: String(r.provider ?? ''),
    }));
  }

  async answerOf(
    tx: Tx,
    orgId: number,
    faqId: number,
  ): Promise<{
    answerType: string;
    answerText: string | null;
    flowId: number | null;
    flowNodeId: string | null;
    question: string;
  } | null> {
    const res = await tx.execute(sql`
      SELECT answer_type, answer_text, flow_id, flow_node_id, question FROM faqs WHERE org_id = ${orgId} AND id = ${faqId} AND status = 'active'`);
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          answerType: r.answer_type as string,
          answerText: text(r.answer_text),
          flowId: numOrNull(r.flow_id),
          flowNodeId: text(r.flow_node_id),
          question: r.question as string,
        }
      : null;
  }
}
