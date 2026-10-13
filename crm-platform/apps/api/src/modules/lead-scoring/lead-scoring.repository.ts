import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { LscRun, LscRunStatus, LscRunTrigger } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  decodeRunCursor,
  encodeRunCursor,
  emailKind,
  customFacts,
  usdString,
} from './lead-scoring.rules';
import type { EngagementFacts, ScoringFacts } from './lead-scoring.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A raw `execute` hands timestamps back as text; the screens and the cursor want a Date. */
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

export interface SettingsRow {
  enabled: boolean;
  autoScore: boolean;
  chatDigest: boolean;
  stageSuggestions: boolean;
  rowVersion: number;
  updatedAt: Date;
}

export interface ContactForScoring {
  id: number;
  uuid: string;
  name: string | null;
  leadScore: number | null;
  leadScoreSource: string | null;
  facts: ScoringFacts;
}

export interface RunWrite {
  contactId: number | null;
  contactName: string | null;
  status: LscRunStatus;
  trigger: LscRunTrigger;
  score: number | null;
  previousScore: number | null;
  reasons: string[] | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: 'vendor' | 'estimate' | 'none';
  billedAgainst: 'admin' | 'workspace' | 'none';
  durationMs: number | null;
  error: string | null;
}

export const toRun = (r: Raw): LscRun => ({
  id: String(r.uuid),
  createdAt: date(r.created_at).toISOString(),
  contactId: str(r.contact_uuid),
  contactName: str(r.contact_name),
  status: r.status as LscRunStatus,
  trigger: r.trigger as LscRunTrigger,
  score: r.score === null ? null : num(r.score),
  previousScore: r.previous_score === null ? null : num(r.previous_score),
  reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
  model: str(r.model),
  promptTokens: num(r.prompt_tokens),
  completionTokens: num(r.completion_tokens),
  costUsd: usdString(Number(r.cost_usd)),
  costSource: r.cost_source as LscRun['costSource'],
  billedAgainst: r.billed_against as LscRun['billedAgainst'],
  durationMs: r.duration_ms === null ? null : num(r.duration_ms),
  error: str(r.error),
});

/** All SQL of AI lead scoring. Every method takes the caller's transaction (tenant context already set by txAs/tx). */
@Injectable()
export class LeadScoringRepository {
  // --- settings -----------------------------------------------------------------------------------------------------

  async getSettings(tx: Tx, orgId: number): Promise<SettingsRow | null> {
    const res = await tx.execute(
      sql`SELECT enabled, auto_score, chat_digest, stage_suggestions, row_version, updated_at FROM lead_scoring_settings WHERE org_id = ${orgId}`,
    );
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      enabled: r.enabled as boolean,
      autoScore: r.auto_score as boolean,
      chatDigest: r.chat_digest as boolean,
      stageSuggestions: r.stage_suggestions as boolean,
      rowVersion: num(r.row_version),
      updatedAt: date(r.updated_at),
    };
  }

  /** First save inserts (no version); later saves need the version they read. Returns false on a conflict. */
  async saveSettings(
    tx: Tx,
    orgId: number,
    w: { enabled: boolean; autoScore: boolean; chatDigest: boolean; stageSuggestions: boolean },
    rowVersion: number | undefined,
  ): Promise<boolean> {
    if (rowVersion === undefined) {
      const res = await tx.execute(sql`
        INSERT INTO lead_scoring_settings (org_id, enabled, auto_score, chat_digest, stage_suggestions)
        VALUES (${orgId}, ${w.enabled}, ${w.autoScore}, ${w.chatDigest}, ${w.stageSuggestions})
        ON CONFLICT (org_id) DO NOTHING RETURNING org_id`);
      return res.rows.length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE lead_scoring_settings SET enabled = ${w.enabled}, auto_score = ${w.autoScore},
             chat_digest = ${w.chatDigest}, stage_suggestions = ${w.stageSuggestions}
      WHERE org_id = ${orgId} AND row_version = ${rowVersion} RETURNING org_id`);
    return res.rows.length > 0;
  }

  // --- contacts -----------------------------------------------------------------------------------------------------

  async contactByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND NOT is_archived`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? num(r.id) : null;
  }

  /** The contact and the anonymised facts the model is given. Null when it no longer exists (deleted since the job was queued). */
  async contactForScoring(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<ContactForScoring | null> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.name, c.lead_score, c.lead_score_source, c.lifecycle_stage, c.status, c.source, c.channel, c.title,
             c.language, c.country_code, c.email, c.phone, c.email_confirmed, c.is_unsubscribed, c.data, c.created_at,
             c.last_activity_at, c.lifecycle_stage_date, co.name AS company_name,
             COALESCE((SELECT array_agg(t.name::text ORDER BY t.name)
                         FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
                        WHERE ct.org_id = c.org_id AND ct.contact_id = c.id), '{}') AS tags,
             (SELECT count(*) FROM deals d WHERE d.org_id = c.org_id AND d.contact_id = c.id AND d.status = 'open') AS deals_open,
             (SELECT count(*) FROM deals d WHERE d.org_id = c.org_id AND d.contact_id = c.id AND d.status = 'won') AS deals_won,
             (SELECT count(*) FROM deals d WHERE d.org_id = c.org_id AND d.contact_id = c.id AND d.status = 'lost') AS deals_lost,
             (SELECT COALESCE(sum(d.value_minor), 0) FROM deals d
               WHERE d.org_id = c.org_id AND d.contact_id = c.id AND d.status = 'open') AS open_value_minor
        FROM contacts c
        LEFT JOIN companies co ON co.org_id = c.org_id AND co.id = c.company_id
       WHERE c.org_id = ${orgId} AND c.id = ${contactId} AND NOT c.is_archived`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    const now = Date.now();
    const days = (d: unknown): number =>
      Math.max(0, Math.floor((now - date(d).getTime()) / DAY_MS));
    const email = str(r.email);
    const engagement = await this.engagementFor(tx, orgId, contactId);
    const enrichment = await this.enrichmentFor(tx, orgId, contactId);
    return {
      id: num(r.id),
      uuid: String(r.uuid),
      name: str(r.name),
      leadScore: r.lead_score === null ? null : num(r.lead_score),
      leadScoreSource: str(r.lead_score_source),
      facts: {
        stage: String(r.lifecycle_stage),
        status: str(r.status),
        source: str(r.source),
        channel: str(r.channel),
        title: str(r.title),
        language: str(r.language),
        country: str(r.country_code),
        hasEmail: email !== null && email !== '',
        hasPhone: str(r.phone) !== null && str(r.phone) !== '',
        emailKind: emailKind(email),
        emailConfirmed: r.email_confirmed === true,
        unsubscribed: r.is_unsubscribed === true,
        company: str(r.company_name),
        tags: ((r.tags as string[] | null) ?? []).slice(0, 20),
        properties: customFacts(r.data),
        daysSinceCreated: days(r.created_at),
        daysSinceActivity: r.last_activity_at ? days(r.last_activity_at) : null,
        dealsOpen: num(r.deals_open),
        dealsWon: num(r.deals_won),
        dealsLost: num(r.deals_lost),
        openDealValue: Math.round(num(r.open_value_minor) / 100),
        daysInStage: days(r.lifecycle_stage_date ?? r.created_at),
        engagement,
        ...(enrichment ? { enrichment } : {}),
      },
    };
  }

  /** What the growth pilot's enrichment found about the contact's company; null for every workspace that has none. */
  private async enrichmentFor(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<ScoringFacts['enrichment'] | null> {
    const res = await tx.execute(sql`
      SELECT data FROM contact_enrichment WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'found'`);
    const d = (res.rows[0] as Raw | undefined)?.data as Record<string, unknown> | undefined;
    if (!d) return null;
    const pick = (k: string): string | undefined =>
      typeof d[k] === 'string' && (d[k] as string).trim() !== ''
        ? (d[k] as string).slice(0, 60)
        : undefined;
    const out = {
      ...(pick('companySize') ? { companySize: pick('companySize') } : {}),
      ...(pick('industry') ? { industry: pick('industry') } : {}),
      ...(pick('seniority') ? { seniority: pick('seniority') } : {}),
      ...(pick('country') ? { country: pick('country') } : {}),
    };
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * How the contact has behaved lately: counts and durations only, all computed here so the model never sees a message. Windows are
   * short on purpose (7 and 30 days): they keep the statements on the recent partitions of `messages` and make the facts mean "now".
   *
   * Threads are found through `conversations.contact_id`; a group thread has no contact, so a group's chatter never lands on a member.
   * A message is dated by when it was said (`provider_ts`, else the row time), never by when it was stored: a history import is stamped
   * with the import time but carries the real one, and a migrated workspace has every message flagged as history yet dated truly. So
   * history is counted when it is recent and ignored when it is old, with no flag test. Reactions and deleted messages are left out.
   * The reply time pairs each message from the contact with the message right before it on the same thread, when that one was ours
   * and at most a week earlier: a reply to a broadcast counts, a message that opens a conversation does not.
   *
   * "Broadcasts" are both senders of bulk messages: the broadcasts module (`broadcast_contacts`) and the WhatsApp campaigns module
   * (`wp_campaign_contacts`, what migrated Reference workspaces use). Link clicks are the tracked links of either.
   */
  private async engagementFor(tx: Tx, orgId: number, contactId: number): Promise<EngagementFacts> {
    const counts = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM broadcast_contacts bc
          WHERE bc.org_id = ${orgId} AND bc.contact_id = ${contactId}
            AND bc.status IN ('sent', 'delivered', 'read') AND bc.sent_at >= now() - interval '30 days')
        + (SELECT count(*) FROM wp_campaign_contacts w
          WHERE w.org_id = ${orgId} AND w.contact_id = ${contactId}
            AND w.sent_at >= now() - interval '30 days') AS broadcasts_received,
        (SELECT count(*) FROM broadcast_contacts bc
          WHERE bc.org_id = ${orgId} AND bc.contact_id = ${contactId}
            AND bc.read_at >= now() - interval '30 days')
        + (SELECT count(*) FROM wp_campaign_contacts w
          WHERE w.org_id = ${orgId} AND w.contact_id = ${contactId}
            AND w.read_at >= now() - interval '30 days') AS broadcasts_read,
        (SELECT count(*) FROM wa_link_clicks l
          WHERE l.org_id = ${orgId} AND l.contact_id = ${contactId}
            AND l.clicks > 0 AND l.last_click_at >= now() - interval '30 days')
        + (SELECT count(*) FROM wp_campaign_contacts w
          WHERE w.org_id = ${orgId} AND w.contact_id = ${contactId}
            AND w.clicked AND w.clicked_at >= now() - interval '30 days') AS links_clicked,
        (SELECT count(*) FROM messages m
           JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
          WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId} AND m.org_id = ${orgId}
            AND m.created_at >= now() - interval '7 days'
            AND COALESCE(m.provider_ts, m.created_at) >= now() - interval '7 days'
            AND m.direction = 'in' AND m.sender_kind = 'customer' AND m.kind <> 'reaction' AND m.deleted_at IS NULL) AS messages_from_contact,
        (SELECT max(cv.last_inbound_at) FROM conversations cv
          WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId}) AS last_inbound_at`);
    const latency = await tx.execute(sql`
      WITH thread AS (
        SELECT m.direction, COALESCE(m.provider_ts, m.created_at) AS at,
               LAG(m.direction) OVER w AS prev_direction, LAG(COALESCE(m.provider_ts, m.created_at)) OVER w AS prev_at
          FROM messages m
          JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
         WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId} AND m.org_id = ${orgId}
           AND m.created_at >= now() - interval '30 days'
           AND COALESCE(m.provider_ts, m.created_at) >= now() - interval '30 days'
           AND m.kind <> 'reaction' AND m.deleted_at IS NULL
        WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.seq)
      )
      SELECT avg(extract(epoch FROM at - prev_at)) / 60 AS avg_reply_minutes
        FROM thread
       WHERE direction = 'in' AND prev_direction = 'out' AND at - prev_at < interval '7 days'`);
    const c = (counts.rows[0] ?? {}) as Raw;
    const avg = (latency.rows[0] as Raw | undefined)?.avg_reply_minutes;
    return {
      broadcastsReceived30d: num(c.broadcasts_received ?? 0),
      broadcastsRead30d: num(c.broadcasts_read ?? 0),
      linksClicked30d: num(c.links_clicked ?? 0),
      messagesFromContact7d: num(c.messages_from_contact ?? 0),
      hoursSinceLastInbound: c.last_inbound_at
        ? Math.max(0, Math.floor((Date.now() - date(c.last_inbound_at).getTime()) / HOUR_MS))
        : null,
      avgReplyMinutes30d:
        avg === null || avg === undefined || !Number.isFinite(Number(avg))
          ? null
          : Math.round(Number(avg)),
    };
  }

  /**
   * Writes an AI score, only while the scorer is allowed to (the contact has no score, or one the scorer wrote). The check is in the
   * statement itself so a person who typed a score a moment ago is never overwritten. Returns the score it replaced, or `false` when
   * the write was refused.
   */
  async writeScore(
    tx: Tx,
    orgId: number,
    contactId: number,
    w: { score: number; reasons: string[]; model: string },
  ): Promise<{ previous: number | null } | false> {
    const res = await tx.execute(sql`
      UPDATE contacts c SET lead_score = ${w.score}, lead_score_source = 'ai', lead_score_reasons = ${JSON.stringify(w.reasons)}::jsonb,
             lead_scored_at = now(), lead_score_model = ${w.model}
        FROM (SELECT lead_score FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}
                 AND (lead_score IS NULL OR lead_score_source = 'ai') FOR UPDATE) old
       WHERE c.org_id = ${orgId} AND c.id = ${contactId}
      RETURNING old.lead_score AS previous`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { previous: r.previous === null ? null : num(r.previous) } : false;
  }

  /** Contacts the scorer may write to and has not scored yet, oldest first: the backfill's worklist. */
  async unscoredIds(tx: Tx, orgId: number, limit: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT id FROM contacts
       WHERE org_id = ${orgId} AND NOT is_archived AND lead_score IS NULL AND lead_scored_at IS NULL
       ORDER BY id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => num(r.id));
  }

  async counts(tx: Tx, orgId: number): Promise<{ eligible: number; scored: number }> {
    const res = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE lead_score IS NULL OR lead_score_source = 'ai') AS eligible,
             count(*) FILTER (WHERE lead_score_source = 'ai') AS scored
        FROM contacts WHERE org_id = ${orgId} AND NOT is_archived`);
    const r = res.rows[0] as Raw;
    return { eligible: num(r.eligible), scored: num(r.scored) };
  }

  // --- the log ------------------------------------------------------------------------------------------------------

  async insertRun(tx: Tx, orgId: number, w: RunWrite): Promise<void> {
    await tx.execute(sql`
      INSERT INTO lead_scoring_runs (org_id, contact_id, contact_name, status, trigger, score, previous_score, reasons, model,
                                     prompt_tokens, completion_tokens, cost_usd, cost_source, billed_against, duration_ms, error)
      VALUES (${orgId}, ${w.contactId}, ${w.contactName}, ${w.status}, ${w.trigger}, ${w.score}, ${w.previousScore},
              ${w.reasons ? JSON.stringify(w.reasons) : null}::jsonb, ${w.model}, ${w.promptTokens}, ${w.completionTokens},
              ${usdString(w.costUsd)}::numeric, ${w.costSource}, ${w.billedAgainst}, ${w.durationMs}, ${w.error})`);
  }

  /** Runs billed to the platform key by this workspace in the last hour (the hourly cost guard counts attempts that reached the vendor). */
  async platformRunsLastHour(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM lead_scoring_runs
       WHERE org_id = ${orgId} AND billed_against = 'admin' AND status IN ('ok', 'kept', 'failed')
         AND created_at >= now() - interval '1 hour'`);
    return num((res.rows[0] as Raw).n);
  }

  async listRuns(
    tx: Tx,
    orgId: number,
    q: { contactUuid?: string; status?: LscRunStatus; cursor?: string; limit: number },
  ): Promise<{ items: LscRun[]; nextCursor: string | null; hasMore: boolean }> {
    const cur = q.cursor ? decodeRunCursor(q.cursor) : null;
    const res = await tx.execute(sql`
      SELECT r.*, c.uuid AS contact_uuid
        FROM lead_scoring_runs r
        LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE r.org_id = ${orgId}
         ${q.contactUuid ? sql`AND c.uuid = ${q.contactUuid}::uuid` : sql``}
         ${q.status ? sql`AND r.status = ${q.status}` : sql``}
         ${cur ? sql`AND (r.created_at, r.id) < (${cur.at.toISOString()}::timestamptz, ${cur.id})` : sql``}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${q.limit + 1}`);
    const rows = res.rows as Raw[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const hasMore = rows.length > q.limit;
    return {
      items: page.map(toRun),
      hasMore,
      nextCursor: hasMore && last ? encodeRunCursor(date(last.created_at), num(last.id)) : null,
    };
  }

  /** Cost and volume of one workspace over a window, from the ledger. */
  async totals(tx: Tx, orgId: number | null, sinceSql: 'day' | 'month'): Promise<Raw> {
    const interval = sinceSql === 'day' ? sql`interval '24 hours'` : sql`interval '30 days'`;
    const res = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'ok') AS scores,
             count(*) FILTER (WHERE status = 'failed') AS failed,
             COALESCE(sum(prompt_tokens), 0) AS prompt_tokens,
             COALESCE(sum(completion_tokens), 0) AS completion_tokens,
             COALESCE(sum(cost_usd), 0) AS cost_usd,
             COALESCE(sum(cost_usd) FILTER (WHERE billed_against = 'admin'), 0) AS platform_cost_usd
        FROM lead_scoring_runs
       WHERE created_at >= now() - ${interval} ${orgId === null ? sql`` : sql`AND org_id = ${orgId}`}`);
    return res.rows[0] as Raw;
  }

  /** Deletes the log older than the retention (privileged: spans workspaces). */
  async deleteOlderThan(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(
      sql`DELETE FROM lead_scoring_runs WHERE created_at < now() - make_interval(days => ${days}) RETURNING 1`,
    );
    return res.rows.length;
  }
}
