import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AppointmentChannel,
  AppointmentMessageKind,
  AppointmentTemplateChannel,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The workspace's choice for one channel (a row exists once somebody has decided). */
export interface ChannelSettingRow {
  id: number;
  channel: AppointmentChannel;
  enabled: boolean;
  defaultSenderId: number | null;
  source: 'owner' | 'legacy_default';
  rowVersion: number;
}

/** A connected sender the owner can pick as the default. */
export interface SenderRow {
  id: number;
  uuid: string;
  label: string;
}

export interface SenderDirectory {
  whatsapp: SenderRow[];
  sms: SenderRow[];
  email: SenderRow[];
  /** A connected WhatsApp number that is not the Cloud API (a QR device): it can send text, not templates. */
  whatsappDevice: boolean;
}

/** A library message with the WhatsApp template it was made into, read together so the status is always live. */
export interface LibraryRow {
  id: number;
  uuid: string;
  kind: AppointmentMessageKind;
  channel: AppointmentTemplateChannel;
  language: string;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  predefinedKey: string | null;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  waTemplateId: number | null;
  waUuid: string | null;
  waStatus: string | null;
  waMetaStatus: string | null;
  waPausedUntil: Date | null;
  waRejectionReason: string | null;
  connectionUuid: string | null;
  usedByTypes: number;
}

/** A text[] literal of placeholder names (a closed set of lower-case words and underscores, so no quoting is needed). */
const textArray = (list: readonly string[]) =>
  sql`${`{${list.filter((x) => /^[a-z_]+$/.test(x)).join(',')}}`}::text[]`;

const toSetting = (r: Raw): ChannelSettingRow => ({
  id: Number(r.id),
  channel: r.channel as AppointmentChannel,
  enabled: r.enabled as boolean,
  defaultSenderId: n(r.default_sender_id),
  source: r.source as ChannelSettingRow['source'],
  rowVersion: Number(r.row_version),
});

const toLibrary = (r: Raw): LibraryRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  kind: r.kind as AppointmentMessageKind,
  channel: r.channel as AppointmentTemplateChannel,
  language: r.language as string,
  name: r.name as string,
  subject: s(r.subject),
  body: r.body as string,
  variables: (r.variables as string[] | null) ?? [],
  predefinedKey: s(r.predefined_key),
  isActive: r.is_active as boolean,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  waTemplateId: n(r.wa_template_id),
  waUuid: s(r.wa_uuid),
  waStatus: s(r.wa_status),
  waMetaStatus: s(r.wa_meta_status),
  waPausedUntil: r.wa_paused_until ? new Date(r.wa_paused_until as string) : null,
  waRejectionReason: s(r.wa_rejection_reason),
  connectionUuid: s(r.connection_uuid),
  usedByTypes: Number(r.used_by_types ?? 0),
});

const LIBRARY_SELECT = sql`
  SELECT m.*, w.uuid AS wa_uuid, w.status AS wa_status, w.meta_status AS wa_meta_status, w.paused_until AS wa_paused_until,
         w.rejection_reason AS wa_rejection_reason, c.uuid AS connection_uuid,
         (SELECT count(DISTINCT bt.booking_type_id) FROM booking_templates bt
           WHERE bt.org_id = m.org_id AND bt.library_template_id = m.id)::int AS used_by_types
  FROM appointment_message_templates m
  LEFT JOIN wa_templates w ON w.org_id = m.org_id AND w.id = m.wa_template_id
  LEFT JOIN wa_provider_configs c ON c.org_id = w.org_id AND c.id = w.provider_config_id`;

/**
 * The workspace's appointment channel choice, the senders it can pick from, and the message library (BL-350, BL-351). Every statement
 * names the workspace; row-level security is the second lock.
 */
@Injectable()
export class AppointmentChannelsRepository {
  // --- channel settings ---------------------------------------------------------------------------------------------------------

  async settings(tx: Tx, orgId: number): Promise<ChannelSettingRow[]> {
    const res = await tx.execute(
      sql`SELECT * FROM appointment_channel_settings WHERE org_id = ${orgId}`,
    );
    return (res.rows as Raw[]).map(toSetting);
  }

  /** What the sender needs per message: is the channel on, and which sender did the owner pick. No row = nobody has decided = off. */
  async gate(
    tx: Tx,
    orgId: number,
    channel: AppointmentChannel,
  ): Promise<{ enabled: boolean; defaultSenderId: number | null }> {
    const res = await tx.execute(sql`
      SELECT enabled, default_sender_id FROM appointment_channel_settings WHERE org_id = ${orgId} AND channel = ${channel}`);
    const r = (res.rows as Raw[])[0];
    return r
      ? { enabled: r.enabled as boolean, defaultSenderId: n(r.default_sender_id) }
      : { enabled: false, defaultSenderId: null };
  }

  /** Creates or changes the choice for one channel. `defaultSenderId` undefined = leave as it is. */
  async upsert(
    tx: Tx,
    orgId: number,
    channel: AppointmentChannel,
    v: { enabled: boolean; defaultSenderId?: number | null; userId: number | null },
  ): Promise<ChannelSettingRow> {
    const keep = v.defaultSenderId === undefined;
    const res = await tx.execute(sql`
      INSERT INTO appointment_channel_settings (org_id, channel, enabled, default_sender_id, source, updated_by)
      VALUES (${orgId}, ${channel}, ${v.enabled}, ${keep ? null : v.defaultSenderId}, 'owner', ${v.userId})
      ON CONFLICT (org_id, channel) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            default_sender_id = ${keep ? sql`appointment_channel_settings.default_sender_id` : sql`EXCLUDED.default_sender_id`},
            source = 'owner', updated_by = EXCLUDED.updated_by
      RETURNING *`);
    const row = (res.rows as Raw[])[0];
    if (!row) throw AppError.notFound('Appointment channel', channel);
    return toSetting(row);
  }

  /** The connected senders of each channel, oldest first. */
  async senders(tx: Tx, orgId: number): Promise<SenderDirectory> {
    const configs = await tx.execute(sql`
      SELECT id, uuid, provider, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND status = 'connected' AND provider IN ('waba', 'sms')
      ORDER BY is_primary DESC, id`);
    const mail = await tx.execute(sql`
      SELECT id, uuid, coalesce(nullif(display_name, ''), address::text) AS label
      FROM mail_mailboxes
      WHERE org_id = ${orgId} AND status = 'connected' AND scope = 'shared'
      ORDER BY created_at, id`);
    const device = await tx.execute(sql`
      SELECT 1 FROM devices WHERE org_id = ${orgId} AND status = 'connected' AND active LIMIT 1`);
    const pick = (provider: string): SenderRow[] =>
      (configs.rows as Raw[])
        .filter((r) => r.provider === provider)
        .map((r) => ({
          id: Number(r.id),
          uuid: r.uuid as string,
          label: (r.label as string | null) ?? '',
        }));
    return {
      whatsapp: pick('waba'),
      sms: pick('sms'),
      email: (mail.rows as Raw[]).map((r) => ({
        id: Number(r.id),
        uuid: r.uuid as string,
        label: (r.label as string | null) ?? '',
      })),
      whatsappDevice: device.rows.length > 0,
    };
  }

  // --- the library --------------------------------------------------------------------------------------------------------------

  async listLibrary(
    tx: Tx,
    orgId: number,
    filter: { kind?: AppointmentMessageKind; channel?: AppointmentTemplateChannel } = {},
  ): Promise<LibraryRow[]> {
    const res = await tx.execute(sql`
      ${LIBRARY_SELECT}
      WHERE m.org_id = ${orgId}
        ${filter.kind ? sql`AND m.kind = ${filter.kind}` : sql``}
        ${filter.channel ? sql`AND m.channel = ${filter.channel}` : sql``}
      ORDER BY m.kind, m.channel, m.created_at, m.id`);
    return (res.rows as Raw[]).map(toLibrary);
  }

  async findLibrary(
    tx: Tx,
    orgId: number,
    uuid: string,
    lock = false,
  ): Promise<LibraryRow | undefined> {
    const res = await tx.execute(sql`
      ${LIBRARY_SELECT}
      WHERE m.org_id = ${orgId} AND m.uuid = ${uuid}::uuid ${lock ? sql`FOR UPDATE OF m` : sql``}`);
    const r = (res.rows as Raw[])[0];
    return r ? toLibrary(r) : undefined;
  }

  async findLibraryById(tx: Tx, orgId: number, id: number): Promise<LibraryRow | undefined> {
    const res = await tx.execute(sql`${LIBRARY_SELECT} WHERE m.org_id = ${orgId} AND m.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toLibrary(r) : undefined;
  }

  /** The library messages by uuid, for a booking type's save. */
  async findLibraryMany(tx: Tx, orgId: number, uuids: string[]): Promise<LibraryRow[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      ${LIBRARY_SELECT}
      WHERE m.org_id = ${orgId} AND m.uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return (res.rows as Raw[]).map(toLibrary);
  }

  async insertLibrary(
    tx: Tx,
    orgId: number,
    v: {
      kind: AppointmentMessageKind;
      channel: AppointmentTemplateChannel;
      language: string;
      name: string;
      subject: string | null;
      body: string;
      variables: string[];
      waTemplateId: number | null;
      predefinedKey: string | null;
      userId: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO appointment_message_templates
        (org_id, kind, channel, language, name, subject, body, variables, wa_template_id, predefined_key, created_by)
      VALUES (${orgId}, ${v.kind}, ${v.channel}, ${v.language}, ${v.name}, ${v.subject}, ${v.body},
              ${textArray(v.variables)},
              ${v.waTemplateId}, ${v.predefinedKey}, ${v.userId})
      RETURNING id`);
    return Number((res.rows as Raw[])[0]!.id);
  }

  async updateLibrary(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      name?: string;
      subject?: string | null;
      body?: string;
      variables?: string[];
      isActive?: boolean;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_message_templates SET
        name = ${v.name ?? sql`name`},
        subject = ${v.subject === undefined ? sql`subject` : v.subject},
        body = ${v.body ?? sql`body`},
        variables = ${v.variables === undefined ? sql`variables` : textArray(v.variables)},
        is_active = ${v.isActive ?? sql`is_active`}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async deleteLibrary(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM appointment_message_templates WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async nameTaken(
    tx: Tx,
    orgId: number,
    v: {
      kind: AppointmentMessageKind;
      channel: AppointmentTemplateChannel;
      language: string;
      name: string;
    },
    exceptId?: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM appointment_message_templates
      WHERE org_id = ${orgId} AND kind = ${v.kind} AND channel = ${v.channel} AND language = ${v.language} AND name = ${v.name}
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`} LIMIT 1`);
    return res.rows.length > 0;
  }
}
