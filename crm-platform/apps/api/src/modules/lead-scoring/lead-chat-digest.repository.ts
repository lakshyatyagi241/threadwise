import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  LscDigest,
  LscDigestSource,
  LscIntent,
  LscSignals,
  LscSuggestion,
  LscSuggestionStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  CHAT_WINDOW_DAYS,
  MAX_CHAT_MESSAGES,
  decodeSuggestionCursor,
  encodeSuggestionCursor,
  type ChatMessage,
  type StageOption,
} from './lead-chat-digest.rules';
import { usdString } from './lead-scoring.rules';

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const iso = (v: unknown): string => date(v).toISOString();

export interface DigestWrite {
  contactId: number;
  throughAt: Date;
  messagesRead: number;
  inboundRead: number;
  source: LscDigestSource;
  intent: LscIntent;
  signals: LscSignals;
  summary: string | null;
  score: number | null;
  reasons: string[];
  suggestedStage: string | null;
  stageConfidence: number | null;
  evidence: string[];
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: 'vendor' | 'estimate' | 'none';
  billedAgainst: 'admin' | 'workspace' | 'none';
  durationMs: number | null;
  trigger: 'chat' | 'manual';
  language?: string | null;
  issue?: string | null;
}

export interface ContactBrief {
  id: number;
  uuid: string;
  name: string | null;
  lifecycleStage: string;
  lifecycleStageDate: Date | null;
}

export interface SuggestionRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  contactName: string | null;
  fromStage: string;
  toStage: string;
  confidence: number;
  reasons: string[];
  status: LscSuggestionStatus;
  source: 'chat' | 'engagement';
  createdAt: Date;
  decidedAt: Date | null;
}

/** A contact the idle sweeper found with a conversation that went quiet and has not been read since. */
export interface DigestCandidate {
  orgId: number;
  contactId: number;
}

const toDigest = (r: Raw): LscDigest => ({
  id: String(r.uuid),
  createdAt: iso(r.created_at),
  contactId: String(r.contact_uuid),
  source: r.source as LscDigestSource,
  intent: r.intent as LscIntent,
  signals: {
    askedPrice: (r.signals as Partial<LscSignals> | null)?.askedPrice === true,
    readyToBuy: (r.signals as Partial<LscSignals> | null)?.readyToBuy === true,
    objection: (r.signals as Partial<LscSignals> | null)?.objection === true,
    urgent: (r.signals as Partial<LscSignals> | null)?.urgent === true,
  },
  summary: str(r.summary),
  language: str(r.language),
  issue: str(r.issue),
  score: r.score === null ? null : num(r.score),
  reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
  suggestedStage: str(r.suggested_stage),
  stageConfidence: r.stage_confidence === null ? null : num(r.stage_confidence),
  messagesRead: num(r.messages_read),
  inboundRead: num(r.inbound_read),
  model: str(r.model),
  costUsd: usdString(Number(r.cost_usd)),
  trigger: r.trigger as 'chat' | 'manual',
});

const toSuggestionRow = (r: Raw): SuggestionRow => ({
  id: num(r.id),
  uuid: String(r.uuid),
  contactId: num(r.contact_id),
  contactUuid: String(r.contact_uuid),
  contactName: str(r.contact_name),
  fromStage: String(r.from_stage),
  toStage: String(r.to_stage),
  confidence: num(r.confidence),
  reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
  status: r.status as LscSuggestionStatus,
  source: r.source === 'engagement' ? 'engagement' : 'chat',
  createdAt: date(r.created_at),
  decidedAt: r.decided_at ? date(r.decided_at) : null,
});

/** The shape the API returns; `labels` turns a stage value into the workspace's own word for it. */
export const toSuggestion = (
  s: SuggestionRow,
  labels: ReadonlyMap<string, string>,
): LscSuggestion => ({
  id: s.uuid,
  contactId: s.contactUuid,
  contactName: s.contactName,
  fromStage: s.fromStage,
  fromStageLabel: labels.get(s.fromStage) ?? s.fromStage,
  toStage: s.toStage,
  toStageLabel: labels.get(s.toStage) ?? s.toStage,
  confidence: s.confidence,
  reasons: s.reasons,
  status: s.status,
  source: s.source,
  createdAt: s.createdAt.toISOString(),
  decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
});

const SUGGESTION_SELECT = sql`
  s.id, s.uuid, s.contact_id, c.uuid AS contact_uuid, c.name AS contact_name, s.from_stage, s.to_stage, s.confidence, s.reasons,
  s.status, s.source, s.created_at, s.decided_at`;

/** All SQL of reading a conversation for lead scoring and of the stage suggestions. Every method takes the caller's transaction. */
@Injectable()
export class LeadChatDigestRepository {
  // --- what the digest is built from --------------------------------------------------------------------------------------

  async orgSlug(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`SELECT slug FROM organizations WHERE id = ${orgId}`);
    return str((res.rows[0] as Raw | undefined)?.slug);
  }

  async contactBrief(tx: Tx, orgId: number, contactId: number): Promise<ContactBrief | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, name, lifecycle_stage, lifecycle_stage_date FROM contacts
      WHERE org_id = ${orgId} AND id = ${contactId} AND NOT is_archived`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) return null;
    return {
      id: num(r.id),
      uuid: String(r.uuid),
      name: str(r.name),
      lifecycleStage: String(r.lifecycle_stage),
      lifecycleStageDate: r.lifecycle_stage_date ? date(r.lifecycle_stage_date) : null,
    };
  }

  /**
   * The contact's recent text messages across its threads, oldest first. A message is dated by when it was said (a migrated or imported
   * one carries its real time). Group threads are left out two ways: a thread without a contact is not found at all, and a message
   * that carries group data is skipped; the same goes for reactions and deleted messages.
   */
  async chatFor(tx: Tx, orgId: number, contactId: number): Promise<ChatMessage[]> {
    const res = await tx.execute(sql`
      SELECT uuid, at, direction, sender_kind, kind, body FROM (
        SELECT m.uuid, COALESCE(m.provider_ts, m.created_at) AS at, m.direction, m.sender_kind, m.kind, m.body, m.id
          FROM messages m
          JOIN conversations cv ON cv.org_id = m.org_id AND cv.id = m.conversation_id
         WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId} AND m.org_id = ${orgId}
           AND cv.peer_key NOT LIKE '%@g.us'
           AND m.created_at >= now() - make_interval(days => ${CHAT_WINDOW_DAYS})
           AND COALESCE(m.provider_ts, m.created_at) >= now() - make_interval(days => ${CHAT_WINDOW_DAYS})
           AND m.deleted_at IS NULL AND m.kind <> 'reaction' AND NOT (m.meta ? 'group')
         ORDER BY COALESCE(m.provider_ts, m.created_at) DESC, m.id DESC
         LIMIT ${MAX_CHAT_MESSAGES}
      ) recent ORDER BY at ASC, id ASC`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: String(r.uuid),
      at: date(r.at),
      direction: r.direction === 'in' ? 'in' : 'out',
      senderKind: String(r.sender_kind),
      kind: String(r.kind),
      body: str(r.body),
    }));
  }

  /** The workspace's own lifecycle stages, in order, with the closing flags. */
  async stages(tx: Tx, orgId: number): Promise<StageOption[]> {
    const res = await tx.execute(sql`
      SELECT value, label, position, is_won, is_lost FROM status_options
       WHERE org_id = ${orgId} AND module_key = 'contacts' AND option_group = 'lifecycle_stage' AND is_active
       ORDER BY position, id`);
    return (res.rows as Raw[]).map((r) => ({
      value: String(r.value),
      label: String(r.label),
      position: num(r.position),
      isWon: r.is_won === true,
      isLost: r.is_lost === true,
    }));
  }

  /** When the newest message the last digest of this contact read was said; null when it was never read. */
  async lastThrough(tx: Tx, orgId: number, contactId: number): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT max(through_at) AS t FROM lead_chat_digests WHERE org_id = ${orgId} AND contact_id = ${contactId}`);
    const t = (res.rows[0] as Raw | undefined)?.t;
    return t ? date(t) : null;
  }

  // --- digests ------------------------------------------------------------------------------------------------------------

  async insertDigest(tx: Tx, orgId: number, w: DigestWrite): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO lead_chat_digests (org_id, contact_id, through_at, messages_read, inbound_read, source, intent, signals, summary, score,
        reasons, suggested_stage, stage_confidence, evidence, model, prompt_tokens, completion_tokens, cost_usd, cost_source,
        billed_against, duration_ms, trigger, language, issue)
      VALUES (${orgId}, ${w.contactId}, ${w.throughAt.toISOString()}::timestamptz, ${w.messagesRead}, ${w.inboundRead}, ${w.source},
        ${w.intent}, ${JSON.stringify(w.signals)}::jsonb, ${w.summary}, ${w.score}, ${JSON.stringify(w.reasons)}::jsonb,
        ${w.suggestedStage}, ${w.stageConfidence}, ${JSON.stringify(w.evidence)}::jsonb, ${w.model}, ${w.promptTokens},
        ${w.completionTokens}, ${w.costUsd}, ${w.costSource}, ${w.billedAgainst}, ${w.durationMs}, ${w.trigger},
        ${w.language ?? null}, ${w.issue ?? null})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /** The workspace's own phrases and extra masked words, from the growth pilot's settings; empty for a workspace outside it. */
  async growthChatConfig(
    tx: Tx,
    orgId: number,
  ): Promise<{
    customPhrases: Array<{ phrase: string; intent: LscIntent }>;
    extraMaskTerms: string[];
  }> {
    const res = await tx.execute(sql`
      SELECT config -> 'customPhrases' AS phrases, config -> 'extraMaskTerms' AS terms FROM growth_settings WHERE org_id = ${orgId}`);
    const r = res.rows[0] as Raw | undefined;
    const phrases = Array.isArray(r?.phrases) ? (r!.phrases as Array<Record<string, unknown>>) : [];
    const terms = Array.isArray(r?.terms) ? (r!.terms as unknown[]) : [];
    return {
      customPhrases: phrases
        .filter((p) => typeof p.phrase === 'string' && typeof p.intent === 'string')
        .map((p) => ({ phrase: String(p.phrase), intent: p.intent as LscIntent })),
      extraMaskTerms: terms.filter((t): t is string => typeof t === 'string'),
    };
  }

  /** The contact's most recently active thread (not a group), with who holds it. */
  async latestConversation(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ id: number; uuid: string; assigneeUserId: number | null } | null> {
    const res = await tx.execute(sql`
      SELECT id, uuid, assignee_user_id FROM conversations
       WHERE org_id = ${orgId} AND contact_id = ${contactId} AND peer_key NOT LIKE '%@g.us'
       ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: num(r.id),
          uuid: String(r.uuid),
          assigneeUserId: r.assignee_user_id === null ? null : num(r.assignee_user_id),
        }
      : null;
  }

  /** The thread a contact's stage line goes into: the newest one-to-one conversation, as its channel and peer. */
  async threadOf(
    tx: Tx,
    orgId: number,
    contactId: number,
  ): Promise<{ channelUuid: string; peerKey: string } | null> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, cv.peer_key FROM conversations cv
        JOIN channels ch ON ch.org_id = cv.org_id AND ch.id = cv.channel_id
       WHERE cv.org_id = ${orgId} AND cv.contact_id = ${contactId} AND cv.peer_key NOT LIKE '%@g.us'
       ORDER BY cv.last_message_at DESC NULLS LAST, cv.id DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { channelUuid: String(r.channel_uuid), peerKey: String(r.peer_key) } : null;
  }

  async latestDigest(tx: Tx, orgId: number, contactUuid: string): Promise<LscDigest | null> {
    const res = await tx.execute(sql`
      SELECT d.*, c.uuid AS contact_uuid FROM lead_chat_digests d
        JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
       WHERE d.org_id = ${orgId} AND c.uuid = ${contactUuid}::uuid
       ORDER BY d.created_at DESC, d.id DESC LIMIT 1`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toDigest(r) : null;
  }

  // --- suggestions --------------------------------------------------------------------------------------------------------

  /** A new suggestion replaces the contact's open one (the unique index allows one). Returns the new suggestion's id. */
  async replacePending(
    tx: Tx,
    orgId: number,
    w: {
      contactId: number;
      digestId: number | null;
      fromStage: string;
      toStage: string;
      confidence: number;
      reasons: string[];
      /** Where the suggestion came from: a reading of the chat (default) or the engagement rule. */
      source?: 'chat' | 'engagement';
    },
  ): Promise<number> {
    await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = 'superseded'
       WHERE org_id = ${orgId} AND contact_id = ${w.contactId} AND status = 'pending'`);
    const res = await tx.execute(sql`
      INSERT INTO lifecycle_stage_suggestions (org_id, contact_id, digest_id, from_stage, to_stage, confidence, reasons, source)
      VALUES (${orgId}, ${w.contactId}, ${w.digestId}, ${w.fromStage}, ${w.toStage}, ${w.confidence}, ${JSON.stringify(w.reasons)}::jsonb,
        ${w.source ?? 'chat'})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /** The open suggestion of a contact is no longer true (the contact moved, or a newer reading found no stage to suggest). */
  async supersedePending(tx: Tx, orgId: number, contactId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = 'superseded'
       WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'pending'`);
  }

  /** An open suggestion that starts from a stage the contact is no longer in is stale. */
  async supersedeStale(
    tx: Tx,
    orgId: number,
    contactId: number,
    currentStage: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = 'superseded'
       WHERE org_id = ${orgId} AND contact_id = ${contactId} AND status = 'pending' AND from_stage <> ${currentStage}`);
  }

  async pendingFor(tx: Tx, orgId: number, contactUuid: string): Promise<SuggestionRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SUGGESTION_SELECT} FROM lifecycle_stage_suggestions s
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND c.uuid = ${contactUuid}::uuid AND s.status = 'pending'`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSuggestionRow(r) : null;
  }

  async suggestionByUuid(tx: Tx, orgId: number, uuid: string): Promise<SuggestionRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SUGGESTION_SELECT} FROM lifecycle_stage_suggestions s
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSuggestionRow(r) : null;
  }

  async suggestionById(tx: Tx, orgId: number, id: number): Promise<SuggestionRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SUGGESTION_SELECT} FROM lifecycle_stage_suggestions s
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSuggestionRow(r) : null;
  }

  /** `auto_applied` -> `undone`: false when it was not auto-applied any more (undone already). */
  async markUndone(tx: Tx, orgId: number, id: number, userId: number | null): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = 'undone', decided_by = ${userId}, decided_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'auto_applied' RETURNING id`);
    return res.rows.length > 0;
  }

  async listSuggestions(
    tx: Tx,
    orgId: number,
    q: { status: LscSuggestionStatus; cursor?: string; limit: number },
  ): Promise<{ items: SuggestionRow[]; nextCursor: string | null; hasMore: boolean }> {
    const cur = q.cursor ? decodeSuggestionCursor(q.cursor) : null;
    const res = await tx.execute(sql`
      SELECT ${SUGGESTION_SELECT} FROM lifecycle_stage_suggestions s
        JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
       WHERE s.org_id = ${orgId} AND s.status = ${q.status}
         ${cur ? sql`AND (s.created_at, s.id) < (${cur.at.toISOString()}::timestamptz, ${cur.id})` : sql``}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ${q.limit + 1}`);
    const rows = (res.rows as Raw[]).map(toSuggestionRow);
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? encodeSuggestionCursor(last.createdAt, last.id) : null,
    };
  }

  /** Marks one open suggestion decided. False when it was no longer open (decided in the meantime, replaced, expired). */
  async decide(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'accepted' | 'dismissed' | 'superseded' | 'auto_applied',
    userId: number | null,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = ${status}, decided_by = ${userId}, decided_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'pending' RETURNING id`);
    return res.rows.length > 0;
  }

  async pendingCount(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*) AS n FROM lifecycle_stage_suggestions WHERE org_id = ${orgId} AND status = 'pending'`);
    return num((res.rows[0] as Raw).n);
  }

  // --- the idle sweeper and the retention sweep ---------------------------------------------------------------------------

  /**
   * Contacts of the workspaces that switched the chat reading on whose last customer message is older than the idle time (but not
   * older than the window) and newer than the last reading. Run privileged across workspaces; the caller only enqueues, and each job
   * re-checks everything in its own workspace.
   */
  async idleCandidates(
    tx: Tx,
    idleMinutes: number,
    windowDays: number,
    limit: number,
  ): Promise<DigestCandidate[]> {
    const res = await tx.execute(sql`
      SELECT cv.org_id, cv.contact_id
        FROM lead_scoring_settings st
        JOIN conversations cv ON cv.org_id = st.org_id
       WHERE st.enabled AND st.chat_digest AND cv.contact_id IS NOT NULL AND cv.peer_key NOT LIKE '%@g.us'
         AND cv.last_inbound_at < now() - make_interval(mins => ${idleMinutes})
         AND cv.last_inbound_at >= now() - make_interval(days => ${windowDays})
       GROUP BY cv.org_id, cv.contact_id
      HAVING max(cv.last_inbound_at) > COALESCE((
               SELECT max(d.through_at) FROM lead_chat_digests d WHERE d.org_id = cv.org_id AND d.contact_id = cv.contact_id
             ), '-infinity'::timestamptz)
       ORDER BY max(cv.last_inbound_at) DESC
       LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ orgId: num(r.org_id), contactId: num(r.contact_id) }));
  }

  /** Digests older than the retention go, and so do decided suggestions; an open suggestion nobody decided in `ttlDays` expires. */
  async sweepOld(
    tx: Tx,
    retentionDays: number,
    ttlDays: number,
  ): Promise<{ digests: number; suggestions: number; expired: number }> {
    const digests = await tx.execute(sql`
      DELETE FROM lead_chat_digests WHERE created_at < now() - make_interval(days => ${retentionDays}) RETURNING 1`);
    const expired = await tx.execute(sql`
      UPDATE lifecycle_stage_suggestions SET status = 'expired', decided_at = now()
       WHERE status = 'pending' AND created_at < now() - make_interval(days => ${ttlDays}) RETURNING 1`);
    const suggestions = await tx.execute(sql`
      DELETE FROM lifecycle_stage_suggestions
       WHERE status <> 'pending' AND created_at < now() - make_interval(days => ${retentionDays}) RETURNING 1`);
    return {
      digests: digests.rows.length,
      suggestions: suggestions.rows.length,
      expired: expired.rows.length,
    };
  }
}
