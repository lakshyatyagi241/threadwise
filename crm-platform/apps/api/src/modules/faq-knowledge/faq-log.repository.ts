import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  FaqCandidate,
  FaqInsights,
  FaqMatchOutcome,
  FaqMatchTier,
  FaqVerifyInfo,
  FaqVerifyMode,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date => new Date(v as string);

export interface LogWrite {
  /** The flow the decision belongs to (internal id). */
  flowId: number;
  origin: 'inbound' | 'test' | 'flow';
  conversationId: number | null;
  channelId: number | null;
  /** Null when the workspace does not keep customer text. */
  query: string | null;
  queryLength: number;
  outcome: FaqMatchOutcome;
  tier: FaqMatchTier | null;
  matchedFaqId: number | null;
  score: number | null;
  secondScore: number | null;
  matchedText: string | null;
  candidates: FaqCandidate[];
  embeddingModel: string | null;
  latencyMs: number | null;
  error: string | null;
  verify: FaqVerifyInfo | null;
}

export interface LogRow {
  id: number;
  uuid: string;
  createdAt: Date;
  origin: 'inbound' | 'test' | 'flow';
  query: string | null;
  queryLength: number;
  outcome: FaqMatchOutcome;
  tier: FaqMatchTier | null;
  faqUuid: string | null;
  faqQuestion: string | null;
  score: number | null;
  secondScore: number | null;
  matchedText: string | null;
  candidates: FaqCandidate[];
  embeddingModel: string | null;
  latencyMs: number | null;
  error: string | null;
  verify: FaqVerifyInfo | null;
  resolved: boolean;
}

export interface LogFilter {
  limit: number;
  afterId: number | null;
  view: 'all' | 'answered' | 'unanswered' | 'errors';
  search?: string;
  faqId?: number;
}

export interface SettingsRow {
  enabled: boolean;
  threshold: number;
  minMargin: number;
  logQueries: boolean;
  verifyMode: FaqVerifyMode;
  verifyBand: number;
  tunedModel: string | null;
  rowVersion: number;
  updatedAt: Date;
}

const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** `faq_match_logs` and `faq_settings`, plus the aggregates the insights screen reads. */
@Injectable()
export class FaqLogRepository {
  // --- settings -----------------------------------------------------------------------------------------------------

  async getSettings(tx: Tx, orgId: number, flowId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(sql`
      SELECT enabled, threshold, min_margin, log_queries, verify_mode, verify_band, tuned_model, row_version, updated_at
      FROM faq_settings WHERE org_id = ${orgId} AND flow_id = ${flowId}`);
    const r = (res.rows as Raw[])[0];
    return r
      ? {
          enabled: r.enabled as boolean,
          threshold: num(r.threshold),
          minMargin: num(r.min_margin),
          logQueries: r.log_queries as boolean,
          verifyMode: r.verify_mode as FaqVerifyMode,
          verifyBand: num(r.verify_band),
          tunedModel: text(r.tuned_model),
          rowVersion: num(r.row_version),
          updatedAt: date(r.updated_at),
        }
      : null;
  }

  /** First save inserts; a later save asserts the version it read. False when the version is stale (or a first save raced). */
  async saveSettings(
    tx: Tx,
    orgId: number,
    flowId: number,
    w: {
      enabled: boolean;
      threshold: number;
      minMargin: number;
      logQueries: boolean;
      verifyMode: FaqVerifyMode;
      verifyBand: number;
      tunedModel: string;
    },
    rowVersion: number | undefined,
  ): Promise<boolean> {
    if (rowVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO faq_settings (org_id, flow_id, enabled, threshold, min_margin, log_queries, verify_mode, verify_band, tuned_model)
        VALUES (${orgId}, ${flowId}, ${w.enabled}, ${w.threshold}, ${w.minMargin}, ${w.logQueries}, ${w.verifyMode}, ${w.verifyBand}, ${w.tunedModel})
        ON CONFLICT (org_id, flow_id) DO NOTHING RETURNING org_id`);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE faq_settings SET enabled = ${w.enabled}, threshold = ${w.threshold}, min_margin = ${w.minMargin},
        log_queries = ${w.logQueries}, verify_mode = ${w.verifyMode}, verify_band = ${w.verifyBand}, tuned_model = ${w.tunedModel}
      WHERE org_id = ${orgId} AND flow_id = ${flowId} AND row_version = ${rowVersion} RETURNING org_id`);
    return res.rows.length > 0;
  }

  // --- the log ------------------------------------------------------------------------------------------------------

  async insert(tx: Tx, orgId: number, w: LogWrite): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO faq_match_logs (org_id, flow_id, origin, conversation_id, channel_id, query, query_length, outcome, tier, matched_faq_id,
                                  score, second_score, matched_text, candidates, embedding_model, latency_ms, error,
                                  verify_verdict, verify_model, verify_reason)
      VALUES (${orgId}, ${w.flowId}, ${w.origin}, ${w.conversationId}, ${w.channelId}, ${w.query}, ${w.queryLength}, ${w.outcome}, ${w.tier},
              ${w.matchedFaqId}, ${w.score}, ${w.secondScore}, ${w.matchedText}, ${JSON.stringify(w.candidates)}::jsonb,
              ${w.embeddingModel}, ${w.latencyMs}, ${w.error}, ${w.verify?.verdict ?? null}, ${w.verify?.model ?? null},
              ${w.verify?.reason ?? null})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  private toLog(r: Raw): LogRow {
    return {
      id: num(r.id),
      uuid: r.uuid as string,
      createdAt: date(r.created_at),
      origin: r.origin as 'inbound' | 'test' | 'flow',
      query: text(r.query),
      queryLength: num(r.query_length),
      outcome: r.outcome as FaqMatchOutcome,
      tier: text(r.tier) as FaqMatchTier | null,
      faqUuid: text(r.faq_uuid),
      faqQuestion: text(r.faq_question),
      score: numOrNull(r.score),
      secondScore: numOrNull(r.second_score),
      matchedText: text(r.matched_text),
      candidates: (r.candidates as FaqCandidate[]) ?? [],
      embeddingModel: text(r.embedding_model),
      latencyMs: numOrNull(r.latency_ms),
      error: text(r.error),
      verify: r.verify_verdict
        ? {
            verdict: r.verify_verdict as FaqVerifyInfo['verdict'],
            model: text(r.verify_model),
            reason: text(r.verify_reason),
          }
        : null,
      resolved: r.resolved_at !== null && r.resolved_at !== undefined,
    };
  }

  private static readonly LOG_COLS = sql`
    l.id, l.uuid, l.created_at, l.origin, l.query, l.query_length, l.outcome, l.tier, f.uuid AS faq_uuid, f.question AS faq_question,
    l.score, l.second_score, l.matched_text, l.candidates, l.embedding_model, l.latency_ms, l.error,
    l.verify_verdict, l.verify_model, l.verify_reason, l.resolved_at`;

  async list(tx: Tx, orgId: number, flowId: number, f: LogFilter): Promise<LogRow[]> {
    const where: SQL[] = [
      sql`l.org_id = ${orgId}`,
      sql`l.flow_id = ${flowId}`,
      sql`l.origin = 'inbound'`,
    ];
    if (f.afterId !== null) where.push(sql`l.id < ${f.afterId}`);
    if (f.view === 'answered') where.push(sql`l.outcome IN ('answered', 'flow_started')`);
    if (f.view === 'unanswered') {
      where.push(
        sql`l.outcome IN ('below_threshold', 'low_margin', 'no_faqs') AND l.resolved_at IS NULL`,
      );
    }
    if (f.view === 'errors') where.push(sql`l.outcome IN ('provider_error', 'not_sent')`);
    if (f.search) where.push(sql`l.query ILIKE ${likeOf(f.search)}`);
    if (f.faqId !== undefined) where.push(sql`l.matched_faq_id = ${f.faqId}`);
    const res = await tx.execute(sql`
      SELECT ${FaqLogRepository.LOG_COLS} FROM faq_match_logs l
      LEFT JOIN faqs f ON f.org_id = l.org_id AND f.id = l.matched_faq_id
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY l.id DESC LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map((r) => this.toLog(r));
  }

  /** A log row of this flow; one of another flow reads as missing. */
  async findByUuid(
    tx: Tx,
    orgId: number,
    flowId: number,
    uuid: string,
  ): Promise<(LogRow & { internalId: number }) | null> {
    const res = await tx.execute(sql`
      SELECT ${FaqLogRepository.LOG_COLS} FROM faq_match_logs l
      LEFT JOIN faqs f ON f.org_id = l.org_id AND f.id = l.matched_faq_id
      WHERE l.org_id = ${orgId} AND l.flow_id = ${flowId} AND l.uuid = ${uuid}`);
    const r = (res.rows as Raw[])[0];
    return r ? { ...this.toLog(r), internalId: num(r.id) } : null;
  }

  async resolve(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE faq_match_logs SET resolved_at = now() WHERE org_id = ${orgId} AND id = ${id} AND resolved_at IS NULL`,
    );
  }

  /** The unanswered messages that equal this text (case-insensitive): resolved together, so the list does not repeat what was fixed. */
  async resolveSameQuery(tx: Tx, orgId: number, flowId: number, query: string): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE faq_match_logs SET resolved_at = now()
      WHERE org_id = ${orgId} AND flow_id = ${flowId} AND origin = 'inbound' AND resolved_at IS NULL
        AND outcome IN ('below_threshold', 'low_margin', 'no_faqs') AND lower(btrim(query)) = lower(btrim(${query}))
      RETURNING id`);
    return res.rows.length;
  }

  /** Retention sweep of one batch (privileged). */
  async purgeOlderThan(tx: Tx, days: number, batch: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM faq_match_logs WHERE (org_id, id) IN (
        SELECT org_id, id FROM faq_match_logs WHERE created_at < now() - make_interval(days => ${days}) LIMIT ${batch})
      RETURNING 1`);
    return res.rows.length;
  }

  // --- insights -----------------------------------------------------------------------------------------------------

  async insights(tx: Tx, orgId: number, flowId: number, days: number): Promise<FaqInsights> {
    const win = sql`l.org_id = ${orgId} AND l.flow_id = ${flowId} AND l.origin = 'inbound' AND l.created_at >= now() - make_interval(days => ${days})`;
    const totals = (
      await tx.execute(sql`
        SELECT count(*) AS messages,
               count(*) FILTER (WHERE outcome = 'answered') AS answered,
               count(*) FILTER (WHERE outcome = 'flow_started') AS flow_started,
               count(*) FILTER (WHERE outcome IN ('below_threshold', 'low_margin', 'no_faqs')) AS unanswered,
               count(*) FILTER (WHERE outcome = 'provider_error') AS provider_errors,
               count(*) FILTER (WHERE outcome = 'not_sent') AS not_sent,
               avg(score) FILTER (WHERE outcome IN ('answered', 'flow_started')) AS avg_score
        FROM faq_match_logs l WHERE ${win}`)
    ).rows[0] as Raw;
    const hist = (
      await tx.execute(sql`
        SELECT LEAST(floor(score * 10), 9)::int AS bucket,
               count(*) FILTER (WHERE outcome IN ('answered', 'flow_started')) AS answered,
               count(*) FILTER (WHERE outcome IN ('below_threshold', 'low_margin')) AS unanswered
        FROM faq_match_logs l WHERE ${win} AND score IS NOT NULL AND score >= 0 GROUP BY 1 ORDER BY 1`)
    ).rows as Raw[];
    const daily = (
      await tx.execute(sql`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE outcome IN ('answered', 'flow_started')) AS answered,
               count(*) FILTER (WHERE outcome IN ('below_threshold', 'low_margin', 'no_faqs')) AS unanswered
        FROM faq_match_logs l WHERE ${win} GROUP BY 1 ORDER BY 1`)
    ).rows as Raw[];
    const top = (
      await tx.execute(sql`
        SELECT f.uuid AS faq_uuid, f.question, count(*) AS hits
        FROM faq_match_logs l JOIN faqs f ON f.org_id = l.org_id AND f.id = l.matched_faq_id
        WHERE ${win} AND l.outcome IN ('answered', 'flow_started')
        GROUP BY f.uuid, f.question ORDER BY hits DESC, f.question LIMIT 5`)
    ).rows as Raw[];
    const never = (
      await tx.execute(sql`
        SELECT count(*) AS n FROM faqs f WHERE f.org_id = ${orgId} AND f.owner_flow_id = ${flowId} AND f.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM faq_match_logs l WHERE l.org_id = f.org_id AND l.matched_faq_id = f.id AND l.origin = 'inbound'
            AND l.outcome IN ('answered', 'flow_started') AND l.created_at >= now() - make_interval(days => ${days}))`)
    ).rows[0] as Raw;
    const unresolved = (
      await tx.execute(sql`
        SELECT count(*) AS n FROM faq_match_logs l
        WHERE l.org_id = ${orgId} AND l.flow_id = ${flowId} AND l.origin = 'inbound' AND l.outcome IN ('below_threshold', 'low_margin', 'no_faqs') AND l.resolved_at IS NULL`)
    ).rows[0] as Raw;

    const messages = num(totals.messages);
    const answered = num(totals.answered);
    const flowStarted = num(totals.flow_started);
    const byBucket = new Map(hist.map((h) => [num(h.bucket), h]));
    return {
      days,
      totals: {
        messages,
        answered,
        flowStarted,
        unanswered: num(totals.unanswered),
        providerErrors: num(totals.provider_errors),
        notSent: num(totals.not_sent),
      },
      answerRate:
        messages === 0 ? 0 : Math.round(((answered + flowStarted) / messages) * 1000) / 1000,
      avgAnsweredScore:
        totals.avg_score === null ? null : Math.round(num(totals.avg_score) * 1000) / 1000,
      scoreHistogram: Array.from({ length: 10 }, (_, i) => ({
        from: i / 10,
        to: (i + 1) / 10,
        answered: num(byBucket.get(i)?.answered ?? 0),
        unanswered: num(byBucket.get(i)?.unanswered ?? 0),
      })),
      daily: daily.map((d) => ({
        day: d.day as string,
        answered: num(d.answered),
        unanswered: num(d.unanswered),
      })),
      topFaqs: top.map((t) => ({
        faqId: t.faq_uuid as string,
        question: t.question as string,
        hits: num(t.hits),
      })),
      neverMatched: num(never.n),
      unresolvedUnanswered: num(unresolved.n),
    };
  }
}
