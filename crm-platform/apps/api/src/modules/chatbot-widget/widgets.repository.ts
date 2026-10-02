import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { parseLauncher, type WidgetLauncher } from '@crm/contracts';

export interface WidgetRow {
  id: number;
  uuid: string;
  userId: number | null;
  assistantId: number | null;
  assistantUuid: string | null;
  assistantName: string | null;
  name: string;
  slug: string;
  embedToken: string;
  mode: string;
  targetWhatsappCc: string | null;
  targetWhatsappNumber: string | null;
  prefilledMessage: string | null;
  position: string;
  buttonColor: string;
  buttonImageUrl: string | null;
  headerTitle: string;
  headerBg: string;
  headerTextColor: string;
  welcomeMessage: string | null;
  messageBubbleColor: string;
  messageTextColor: string;
  bodyBgKind: string;
  bodyBgColor: string;
  bodyBgImageUrl: string | null;
  autoOpen: boolean;
  buttonLabel: string;
  actionButtonBg: string;
  actionButtonTextColor: string;
  collectName: boolean;
  collectEmail: boolean;
  collectPhone: boolean;
  status: string;
  allowedDomains: string[];
  /** The WhatsApp widget's look and placement, with every missing key at its default (WD-WGT-028). */
  launcher: WidgetLauncher;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  /** Only the list query fills it. */
  visitors: number;
}

/** What a create or update writes; every column the form owns. `undefined` keeps the stored value on update. */
export interface WidgetWrite {
  name: string;
  mode: string;
  assistantId: number | null;
  targetWhatsappCc: string | null;
  targetWhatsappNumber: string | null;
  prefilledMessage: string | null;
  position: string;
  buttonColor: string;
  buttonImageUrl: string | null;
  headerTitle: string;
  headerBg: string;
  headerTextColor: string;
  welcomeMessage: string | null;
  messageBubbleColor: string;
  messageTextColor: string;
  bodyBgKind: string;
  bodyBgColor: string;
  bodyBgImageUrl: string | null;
  autoOpen?: boolean;
  buttonLabel: string;
  actionButtonBg: string;
  actionButtonTextColor: string;
  collectName?: boolean;
  collectEmail?: boolean;
  collectPhone?: boolean;
  allowedDomains?: string[];
  /** Absent keeps the stored config on update and starts from the defaults on insert. */
  launcher?: WidgetLauncher;
}

type Raw = Record<string, unknown>;

const COLUMNS = sql`
  w.id, w.uuid, w.user_id, w.assistant_id, a.uuid AS assistant_uuid, a.name AS assistant_name, w.name, w.slug,
  w.embed_token, w.mode, w.target_whatsapp_cc, w.target_whatsapp_number, w.prefilled_message, w.position,
  w.button_color, w.button_image_url, w.header_title, w.header_bg, w.header_text_color, w.welcome_message,
  w.message_bubble_color, w.message_text_color, w.body_bg_kind, w.body_bg_color, w.body_bg_image_url, w.auto_open,
  w.button_label, w.action_button_bg, w.action_button_text_color, w.collect_name, w.collect_email, w.collect_phone,
  w.status, w.allowed_domains, w.launcher, w.created_at, w.updated_at, w.row_version`;

const FROM = sql`
  chatbot_widgets w
  LEFT JOIN ai_chat_assistants a ON a.org_id = w.org_id AND a.id = w.assistant_id`;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toRow = (r: Raw): WidgetRow => ({
  id: num(r.id),
  uuid: r.uuid as string,
  userId: numOrNull(r.user_id),
  assistantId: numOrNull(r.assistant_id),
  assistantUuid: (r.assistant_uuid as string | null) ?? null,
  assistantName: (r.assistant_name as string | null) ?? null,
  name: r.name as string,
  slug: r.slug as string,
  embedToken: r.embed_token as string,
  mode: r.mode as string,
  targetWhatsappCc: (r.target_whatsapp_cc as string | null) ?? null,
  targetWhatsappNumber: (r.target_whatsapp_number as string | null) ?? null,
  prefilledMessage: (r.prefilled_message as string | null) ?? null,
  position: r.position as string,
  buttonColor: r.button_color as string,
  buttonImageUrl: (r.button_image_url as string | null) ?? null,
  headerTitle: r.header_title as string,
  headerBg: r.header_bg as string,
  headerTextColor: r.header_text_color as string,
  welcomeMessage: (r.welcome_message as string | null) ?? null,
  messageBubbleColor: r.message_bubble_color as string,
  messageTextColor: r.message_text_color as string,
  bodyBgKind: r.body_bg_kind as string,
  bodyBgColor: r.body_bg_color as string,
  bodyBgImageUrl: (r.body_bg_image_url as string | null) ?? null,
  autoOpen: r.auto_open as boolean,
  buttonLabel: r.button_label as string,
  actionButtonBg: r.action_button_bg as string,
  actionButtonTextColor: r.action_button_text_color as string,
  collectName: r.collect_name as boolean,
  collectEmail: r.collect_email as boolean,
  collectPhone: r.collect_phone as boolean,
  status: r.status as string,
  allowedDomains: Array.isArray(r.allowed_domains) ? (r.allowed_domains as string[]) : [],
  launcher: parseLauncher(r.launcher),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: num(r.row_version),
  visitors: r.visitors === undefined ? 0 : num(r.visitors),
});

export interface ListFilter {
  limit: number;
  /** Keyset: the id of the last row of the previous page (newest first, so the next page has smaller ids). */
  afterId: number | null;
}

/** The widget tables, tenant-scoped through the caller's transaction (RLS) and again by `org_id` in every statement. */
@Injectable()
export class WidgetsRepository {
  /** One page, newest first, with visitor counts in the same statement (no N+1). Fetches one extra row for `hasMore`. */
  async list(tx: Tx, orgId: number, f: ListFilter): Promise<WidgetRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS},
             (SELECT count(*) FROM chatbot_widget_visitors v WHERE v.org_id = w.org_id AND v.widget_id = w.id) AS visitors
      FROM ${FROM}
      WHERE w.org_id = ${orgId}
        AND (${f.afterId}::bigint IS NULL OR w.id < ${f.afterId}::bigint)
      ORDER BY w.id DESC
      LIMIT ${f.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** Workspace-wide numbers for the stat cards; they ignore the list filter. */
  async stats(tx: Tx, orgId: number): Promise<{ total: number; active: number; visitors: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM chatbot_widgets WHERE org_id = ${orgId}) AS total,
             (SELECT count(*) FROM chatbot_widgets WHERE org_id = ${orgId} AND status = 'active') AS active,
             (SELECT count(*) FROM chatbot_widget_visitors WHERE org_id = ${orgId}) AS visitors`);
    const r = res.rows[0] as Raw;
    return { total: num(r.total), active: num(r.active), visitors: num(r.visitors) };
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<WidgetRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM} WHERE w.org_id = ${orgId} AND w.uuid = ${uuid}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<WidgetRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM} WHERE w.org_id = ${orgId} AND w.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /**
   * Serialises slug allocation per organization for the rest of the transaction. Two saves of the same name racing (a double
   * click on Launch) would otherwise both see the slug free and the second would fail on the unique index; WaDesk's
   * check-then-insert let both through only because its server handled one request at a time.
   */
  async lockSlugs(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wgt-slug:${orgId}`}, 0))`,
    );
  }

  /** Slugs of the workspace that could collide with `base` (`base`, `base-2`, ...), leaving out the widget being saved. */
  async slugsLike(
    tx: Tx,
    orgId: number,
    base: string,
    exceptId: number | null,
  ): Promise<Set<string>> {
    const escaped = base.replace(/[\\%_]/g, (c) => `\\${c}`);
    const res = await tx.execute(sql`
      SELECT slug FROM chatbot_widgets
      WHERE org_id = ${orgId} AND (slug = ${base} OR slug LIKE ${`${escaped}-%`})
        AND (${exceptId}::bigint IS NULL OR id <> ${exceptId}::bigint)`);
    return new Set((res.rows as Array<{ slug: string }>).map((r) => r.slug));
  }

  async insert(
    tx: Tx,
    orgId: number,
    userId: number | null,
    slug: string,
    embedToken: string,
    w: WidgetWrite,
    status = 'active',
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO chatbot_widgets (
        org_id, user_id, assistant_id, name, slug, embed_token, mode, target_whatsapp_cc, target_whatsapp_number,
        prefilled_message, position, button_color, button_image_url, header_title, header_bg, header_text_color,
        welcome_message, message_bubble_color, message_text_color, body_bg_kind, body_bg_color, body_bg_image_url,
        auto_open, button_label, action_button_bg, action_button_text_color, collect_name, collect_email, collect_phone,
        status, allowed_domains, launcher)
      VALUES (
        ${orgId}, ${userId}, ${w.assistantId}, ${w.name}, ${slug}, ${embedToken}, ${w.mode}, ${w.targetWhatsappCc},
        ${w.targetWhatsappNumber}, ${w.prefilledMessage}, ${w.position}, ${w.buttonColor}, ${w.buttonImageUrl},
        ${w.headerTitle}, ${w.headerBg}, ${w.headerTextColor}, ${w.welcomeMessage}, ${w.messageBubbleColor},
        ${w.messageTextColor}, ${w.bodyBgKind}, ${w.bodyBgColor}, ${w.bodyBgImageUrl}, ${w.autoOpen ?? false},
        ${w.buttonLabel}, ${w.actionButtonBg}, ${w.actionButtonTextColor}, ${w.collectName ?? true},
        ${w.collectEmail ?? false}, ${w.collectPhone ?? false}, ${status},
        ${w.allowedDomains === undefined ? null : JSON.stringify(w.allowedDomains)}::jsonb,
        ${JSON.stringify(w.launcher ?? {})}::jsonb)
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /**
   * Overwrites the form's columns. The flags and the allow-list only change when the payload carries them (the builder
   * always sends the flags and never the list). Returns false when the row is gone or moved on since it was read.
   */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    slug: string,
    w: WidgetWrite,
    rowVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE chatbot_widgets SET
        assistant_id = ${w.assistantId}, name = ${w.name}, slug = ${slug}, mode = ${w.mode},
        target_whatsapp_cc = ${w.targetWhatsappCc}, target_whatsapp_number = ${w.targetWhatsappNumber},
        prefilled_message = ${w.prefilledMessage}, position = ${w.position}, button_color = ${w.buttonColor},
        button_image_url = ${w.buttonImageUrl}, header_title = ${w.headerTitle}, header_bg = ${w.headerBg},
        header_text_color = ${w.headerTextColor}, welcome_message = ${w.welcomeMessage},
        message_bubble_color = ${w.messageBubbleColor}, message_text_color = ${w.messageTextColor},
        body_bg_kind = ${w.bodyBgKind}, body_bg_color = ${w.bodyBgColor}, body_bg_image_url = ${w.bodyBgImageUrl},
        auto_open = COALESCE(${w.autoOpen ?? null}::boolean, auto_open), button_label = ${w.buttonLabel},
        action_button_bg = ${w.actionButtonBg}, action_button_text_color = ${w.actionButtonTextColor},
        collect_name = COALESCE(${w.collectName ?? null}::boolean, collect_name),
        collect_email = COALESCE(${w.collectEmail ?? null}::boolean, collect_email),
        collect_phone = COALESCE(${w.collectPhone ?? null}::boolean, collect_phone),
        allowed_domains = COALESCE(${w.allowedDomains === undefined ? null : JSON.stringify(w.allowedDomains)}::jsonb, allowed_domains),
        launcher = COALESCE(${w.launcher === undefined ? null : JSON.stringify(w.launcher)}::jsonb, launcher)
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async setToken(tx: Tx, orgId: number, id: number, token: string): Promise<void> {
    await tx.execute(sql`
      UPDATE chatbot_widgets SET embed_token = ${token} WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Hard delete: the visitors go with it (FK cascade); conversations and contacts stay in the inbox. */
  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM chatbot_widgets WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
