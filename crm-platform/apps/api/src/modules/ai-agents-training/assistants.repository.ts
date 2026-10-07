import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface AssistantRow {
  id: number;
  uuid: string;
  userId: number | null;
  name: string;
  slug: string;
  greeting: string | null;
  systemPrompt: string | null;
  tone: string;
  language: string;
  aiProvider: string;
  aiModel: string;
  replyMaxTokens: number;
  temperature: number;
  fallbackMessage: string | null;
  handoffEnabled: boolean;
  handoffKeyword: string | null;
  handoffMessage: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  /** The assistant's own entries (workspace-wide ones are not counted, as in WaDesk's list). */
  sourceCount: number;
}

/** What a create or update writes. */
export interface AssistantWrite {
  name: string;
  greeting: string | null;
  systemPrompt: string | null;
  tone: string;
  language: string;
  aiProvider: string;
  aiModel: string;
  replyMaxTokens: number;
  temperature: number;
  fallbackMessage: string | null;
  handoffEnabled: boolean;
  handoffKeyword: string | null;
  handoffMessage: string | null;
  status: string;
}

export interface PickerRow {
  uuid: string;
  name: string;
  aiProvider: string;
  aiModel: string;
  sources: number;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const COLUMNS = sql`
  a.id, a.uuid, a.user_id, a.name, a.slug, a.greeting, a.system_prompt, a.tone, a.language, a.ai_provider, a.ai_model,
  a.reply_max_tokens, a.temperature, a.fallback_message, a.handoff_enabled, a.handoff_keyword, a.handoff_message, a.status,
  a.created_at, a.updated_at, a.row_version,
  (SELECT count(*) FROM ai_training_sources s WHERE s.org_id = a.org_id AND s.assistant_id = a.id) AS source_count`;

const toRow = (r: Raw): AssistantRow => ({
  id: num(r.id),
  uuid: r.uuid as string,
  userId: r.user_id === null ? null : num(r.user_id),
  name: r.name as string,
  slug: r.slug as string,
  greeting: text(r.greeting),
  systemPrompt: text(r.system_prompt),
  tone: r.tone as string,
  language: r.language as string,
  aiProvider: r.ai_provider as string,
  aiModel: r.ai_model as string,
  replyMaxTokens: num(r.reply_max_tokens),
  temperature: num(r.temperature),
  fallbackMessage: text(r.fallback_message),
  handoffEnabled: r.handoff_enabled as boolean,
  handoffKeyword: text(r.handoff_keyword),
  handoffMessage: text(r.handoff_message),
  status: r.status as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: num(r.row_version),
  sourceCount: num(r.source_count),
});

/** `ai_chat_assistants`, tenant-scoped through the caller's transaction (RLS) and again by `org_id` in every statement. */
@Injectable()
export class AssistantsRepository {
  /** One page, newest first. Fetches one extra row for `hasMore` (a COUNT would cost more than the page). */
  async list(
    tx: Tx,
    orgId: number,
    f: { limit: number; afterId: number | null },
  ): Promise<AssistantRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ai_chat_assistants a
      WHERE a.org_id = ${orgId} AND (${f.afterId}::bigint IS NULL OR a.id < ${f.afterId}::bigint)
      ORDER BY a.id DESC
      LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** The stat cards: workspace-wide, independent of the page. */
  async stats(
    tx: Tx,
    orgId: number,
  ): Promise<{ all: number; active: number; sources: number; ready: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM ai_chat_assistants WHERE org_id = ${orgId}) AS total,
             (SELECT count(*) FROM ai_chat_assistants WHERE org_id = ${orgId} AND status = 'active') AS active,
             (SELECT count(*) FROM ai_training_sources WHERE org_id = ${orgId}) AS sources,
             (SELECT count(*) FROM ai_training_sources WHERE org_id = ${orgId} AND status = 'ready') AS ready`);
    const r = res.rows[0] as Raw;
    return {
      all: num(r.total),
      active: num(r.active),
      sources: num(r.sources),
      ready: num(r.ready),
    };
  }

  /** Active assistants by name, with the count of ready entries each would answer from (its own plus workspace-wide). */
  async picker(tx: Tx, orgId: number): Promise<PickerRow[]> {
    const res = await tx.execute(sql`
      SELECT a.uuid, a.name, a.ai_provider, a.ai_model,
        (SELECT count(*) FROM ai_training_sources s WHERE s.org_id = a.org_id AND s.status = 'ready'
           AND (s.assistant_id IS NULL OR s.assistant_id = a.id)) AS sources
      FROM ai_chat_assistants a
      WHERE a.org_id = ${orgId} AND a.status = 'active'
      ORDER BY a.name, a.id`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      name: r.name as string,
      aiProvider: r.ai_provider as string,
      aiModel: r.ai_model as string,
      sources: num(r.sources),
    }));
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<AssistantRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM ai_chat_assistants a WHERE a.org_id = ${orgId} AND a.uuid = ${uuid}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<AssistantRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM ai_chat_assistants a WHERE a.org_id = ${orgId} AND a.id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /**
   * Serialises slug allocation per organization for the rest of the transaction: two saves of one name racing (a double click on
   * Finish) would both see the slug free and the second would fail on the unique index.
   */
  async lockSlugs(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`aiag-slug:${orgId}`}, 0))`,
    );
  }

  /** Slugs of the workspace that could collide with `base` (`base`, `base-2`, ...). */
  async slugsLike(tx: Tx, orgId: number, base: string): Promise<Set<string>> {
    const escaped = base.replace(/[\\%_]/g, (c) => `\\${c}`);
    const res = await tx.execute(sql`
      SELECT slug FROM ai_chat_assistants
      WHERE org_id = ${orgId} AND (slug = ${base} OR slug LIKE ${`${escaped}-%`})`);
    return new Set((res.rows as Array<{ slug: string }>).map((r) => r.slug));
  }

  async insert(
    tx: Tx,
    orgId: number,
    userId: number | null,
    slug: string,
    w: AssistantWrite,
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO ai_chat_assistants (
        org_id, user_id, name, slug, greeting, system_prompt, tone, language, ai_provider, ai_model, reply_max_tokens,
        temperature, fallback_message, handoff_enabled, handoff_keyword, handoff_message, status)
      VALUES (
        ${orgId}, ${userId}, ${w.name}, ${slug}, ${w.greeting}, ${w.systemPrompt}, ${w.tone}, ${w.language}, ${w.aiProvider},
        ${w.aiModel}, ${w.replyMaxTokens}, ${w.temperature}, ${w.fallbackMessage}, ${w.handoffEnabled}, ${w.handoffKeyword},
        ${w.handoffMessage}, ${w.status})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /** Overwrites the form's columns (the slug stays: the address of a saved assistant does not move on a rename). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    w: AssistantWrite,
    rowVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE ai_chat_assistants SET
        name = ${w.name}, greeting = ${w.greeting}, system_prompt = ${w.systemPrompt}, tone = ${w.tone},
        language = ${w.language}, ai_provider = ${w.aiProvider}, ai_model = ${w.aiModel},
        reply_max_tokens = ${w.replyMaxTokens}, temperature = ${w.temperature}, fallback_message = ${w.fallbackMessage},
        handoff_enabled = ${w.handoffEnabled}, handoff_keyword = ${w.handoffKeyword},
        handoff_message = ${w.handoffMessage}, status = ${w.status}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Hard delete. Its own entries go with it by foreign key cascade; the caller removes their stored files first. */
  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM ai_chat_assistants WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
