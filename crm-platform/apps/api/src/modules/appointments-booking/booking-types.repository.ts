import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  BookingLocationType,
  BookingReminderChannel,
  BookingReminderKind,
  BookingQuestionType,
  BookingTemplateChannel,
  BookingTemplateEvent,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const hhmm = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v).slice(0, 5);

export interface BookingTypeRow {
  id: number;
  uuid: string;
  hostId: number | null;
  hostUuid: string | null;
  hostName: string | null;
  name: string;
  slug: string;
  description: string | null;
  locationType: BookingLocationType;
  locationValue: string | null;
  color: string | null;
  introMessage: string | null;
  durationMinutes: number;
  incrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  capacity: number;
  timezone: string | null;
  approvalRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  appointmentsCount: number;
  upcomingCount: number;
}

export interface RuleRow {
  weekday: number;
  from: string;
  to: string;
}
export interface OverrideRow {
  date: string;
  isClosed: boolean;
  from: string | null;
  to: string | null;
  reason: string | null;
}
export interface QuestionRow {
  id: number;
  uuid: string;
  label: string;
  type: BookingQuestionType;
  options: string[] | null;
  required: boolean;
  mapToContactField: 'name' | 'email' | 'phone' | null;
  sortOrder: number;
}
export interface ReminderRow {
  id: number;
  uuid: string;
  offsetIndex: number;
  offsetMinutes: number;
  label: string | null;
  isActive: boolean;
  /** `before` the start or `after` the end (the follow-up). */
  kind: BookingReminderKind;
  channels: BookingReminderChannel[];
  subject: string | null;
  body: string | null;
  waTemplateId: number | null;
  waTemplateUuid: string | null;
}
export interface TemplateRow {
  event: BookingTemplateEvent;
  channel: BookingTemplateChannel;
  waTemplateId: number | null;
  waTemplateUuid: string | null;
  plainBody: string | null;
  variableMap: Record<string, string> | null;
}
export interface FinancialRow {
  feeMinor: bigint;
  taxPct: string;
  currency: string | null;
  gatewaySlug: string | null;
  depositMode: 'none' | 'partial' | 'full';
  depositValueMinor: bigint;
  autoSendLink: boolean;
  cancelFeeMinor: bigint;
  noShowFeeMinor: bigint;
  cancelWindowMinutes: number;
}
export interface IntegrationRow {
  calendarId: string | null;
  createMeet: boolean;
  spreadsheetId: string | null;
  sheetRange: string;
}

export interface TypeChildren {
  rules: RuleRow[];
  overrides: OverrideRow[];
  questions: QuestionRow[];
  reminders: ReminderRow[];
  templates: TemplateRow[];
  financial: FinancialRow | null;
  integration: IntegrationRow | null;
}

/** A text[] literal for the channels column. The values are a closed set of words, so no quoting is needed. */
const channelsArray = (channels: readonly string[]) => sql`${`{${channels.join(',')}}`}::text[]`;

const toRow = (r: Raw): BookingTypeRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  hostId: n(r.user_id),
  hostUuid: s(r.host_uuid),
  hostName: s(r.host_name),
  name: r.name as string,
  slug: r.slug as string,
  description: s(r.description),
  locationType: r.location_type as BookingLocationType,
  locationValue: s(r.location_value),
  color: s(r.color),
  introMessage: s(r.intro_message),
  durationMinutes: Number(r.duration_minutes),
  incrementMinutes: Number(r.increment_minutes),
  bufferBeforeMinutes: Number(r.buffer_before_minutes),
  bufferAfterMinutes: Number(r.buffer_after_minutes),
  minNoticeMinutes: Number(r.min_notice_minutes),
  maxAdvanceDays: Number(r.max_advance_days),
  maxPerDay: n(r.max_per_day),
  capacity: Number(r.capacity),
  timezone: s(r.timezone),
  approvalRequired: r.approval_required as boolean,
  isActive: r.is_active as boolean,
  sortOrder: Number(r.sort_order),
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  appointmentsCount: Number(r.appointments_count ?? 0),
  upcomingCount: Number(r.upcoming_count ?? 0),
});

const SELECT = sql`
  SELECT t.*, u.uuid AS host_uuid, u.full_name AS host_name,
         (SELECT count(*) FROM appointments a WHERE a.org_id = t.org_id AND a.booking_type_id = t.id) AS appointments_count,
         (SELECT count(*) FROM appointments a WHERE a.org_id = t.org_id AND a.booking_type_id = t.id
            AND a.status IN ('pending', 'confirmed') AND a.starts_at > now()) AS upcoming_count
  FROM booking_types t
  LEFT JOIN users u ON u.org_id = t.org_id AND u.id = t.user_id`;

/** Everything a write may set on the type's own row (snake_case column -> value). */
export type TypePatch = Record<string, unknown>;

@Injectable()
export class BookingTypesRepository {
  async list(
    tx: Tx,
    orgId: number,
    filter: { q?: string; active?: boolean },
  ): Promise<BookingTypeRow[]> {
    const conds = [sql`t.org_id = ${orgId}`];
    if (filter.active !== undefined) conds.push(sql`t.is_active = ${filter.active}`);
    if (filter.q) conds.push(sql`t.name ILIKE ${`%${filter.q.replace(/[\\%_]/g, '\\$&')}%`}`);
    const res = await tx.execute(
      sql`${SELECT} WHERE ${sql.join(conds, sql` AND `)} ORDER BY t.sort_order, t.id DESC LIMIT 200`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<BookingTypeRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE OF t` : sql``}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<BookingTypeRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findBySlug(tx: Tx, orgId: number, slug: string): Promise<BookingTypeRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} AND t.slug = ${slug}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async activeTypes(tx: Tx, orgId: number): Promise<BookingTypeRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE t.org_id = ${orgId} AND t.is_active ORDER BY t.sort_order, t.name`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async slugTaken(tx: Tx, orgId: number, slug: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM booking_types WHERE org_id = ${orgId} AND slug = ${slug} ${
        exceptId ? sql`AND id <> ${exceptId}` : sql``
      } LIMIT 1`,
    );
    return res.rows.length > 0;
  }

  async insert(tx: Tx, orgId: number, v: TypePatch): Promise<number> {
    const cols = Object.keys(v);
    const res = await tx.execute(sql`
      INSERT INTO booking_types (org_id, ${sql.join(
        cols.map((c) => sql.raw(`"${c}"`)),
        sql`, `,
      )})
      VALUES (${orgId}, ${sql.join(
        cols.map((c) => sql`${v[c]}`),
        sql`, `,
      )})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Optimistic update: false when the version moved. `row_version` is bumped by the touch trigger. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number | undefined,
    v: TypePatch,
  ): Promise<boolean> {
    const cols = Object.keys(v);
    if (cols.length === 0) return true;
    const sets = cols.map((c) => sql`${sql.raw(`"${c}"`)} = ${v[c]}`);
    const res = await tx.execute(sql`
      UPDATE booking_types SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} ${rowVersion !== undefined ? sql`AND row_version = ${rowVersion}` : sql``}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM booking_types WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async hasUpcoming(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM appointments WHERE org_id = ${orgId} AND booking_type_id = ${id}
        AND status IN ('pending', 'confirmed') AND ends_at > now() LIMIT 1`);
    return res.rows.length > 0;
  }

  // --- children -----------------------------------------------------------------------------------------------------------

  async children(tx: Tx, orgId: number, typeIds: number[]): Promise<Map<number, TypeChildren>> {
    const out = new Map<number, TypeChildren>();
    if (typeIds.length === 0) return out;
    for (const id of typeIds)
      out.set(id, {
        rules: [],
        overrides: [],
        questions: [],
        reminders: [],
        templates: [],
        financial: null,
        integration: null,
      });
    const ids = sql`(${sql.join(
      typeIds.map((i) => sql`${i}`),
      sql`, `,
    )})`;
    const get = (id: unknown) => out.get(Number(id))!;

    for (const r of (
      await tx.execute(sql`SELECT booking_type_id, weekday, start_time, end_time FROM booking_availability_rules
        WHERE org_id = ${orgId} AND booking_type_id IN ${ids} ORDER BY weekday, start_time`)
    ).rows as Raw[])
      get(r.booking_type_id).rules.push({
        weekday: Number(r.weekday),
        from: hhmm(r.start_time)!,
        to: hhmm(r.end_time)!,
      });

    for (const r of (
      await tx.execute(sql`SELECT booking_type_id, to_char(date, 'YYYY-MM-DD') AS date, is_closed, start_time, end_time, reason
        FROM booking_availability_overrides WHERE org_id = ${orgId} AND booking_type_id IN ${ids} ORDER BY date`)
    ).rows as Raw[])
      get(r.booking_type_id).overrides.push({
        date: r.date as string,
        isClosed: r.is_closed as boolean,
        from: hhmm(r.start_time),
        to: hhmm(r.end_time),
        reason: s(r.reason),
      });

    for (const r of (
      await tx.execute(
        sql`SELECT * FROM booking_questions WHERE org_id = ${orgId} AND booking_type_id IN ${ids} ORDER BY sort_order, id`,
      )
    ).rows as Raw[])
      get(r.booking_type_id).questions.push({
        id: Number(r.id),
        uuid: r.uuid as string,
        label: r.label as string,
        type: r.type as BookingQuestionType,
        options: Array.isArray(r.options) ? (r.options as string[]) : null,
        required: r.required as boolean,
        mapToContactField: (r.map_to_contact_field as 'name' | 'email' | 'phone' | null) ?? null,
        sortOrder: Number(r.sort_order),
      });

    for (const r of (
      await tx.execute(
        sql`SELECT br.*, w.uuid AS wa_uuid FROM booking_reminders br
          LEFT JOIN wa_templates w ON w.org_id = br.org_id AND w.id = br.wa_template_id
          WHERE br.org_id = ${orgId} AND br.booking_type_id IN ${ids}
          ORDER BY br.kind, br.offset_minutes DESC`,
      )
    ).rows as Raw[])
      get(r.booking_type_id).reminders.push({
        id: Number(r.id),
        uuid: r.uuid as string,
        offsetIndex: Number(r.offset_index),
        offsetMinutes: Number(r.offset_minutes),
        label: s(r.label),
        isActive: r.is_active as boolean,
        kind: r.kind as BookingReminderKind,
        channels: (r.channels as BookingReminderChannel[] | null) ?? ['whatsapp', 'sms', 'email'],
        subject: s(r.subject),
        body: s(r.body),
        waTemplateId: n(r.wa_template_id),
        waTemplateUuid: s(r.wa_uuid),
      });

    for (const r of (
      await tx.execute(sql`SELECT bt.*, w.uuid AS wa_uuid FROM booking_templates bt
        LEFT JOIN wa_templates w ON w.org_id = bt.org_id AND w.id = bt.wa_template_id
        WHERE bt.org_id = ${orgId} AND bt.booking_type_id IN ${ids} ORDER BY bt.event, bt.channel`)
    ).rows as Raw[])
      get(r.booking_type_id).templates.push({
        event: r.event as BookingTemplateEvent,
        channel: r.channel as BookingTemplateChannel,
        waTemplateId: n(r.wa_template_id),
        waTemplateUuid: s(r.wa_uuid),
        plainBody: s(r.plain_body),
        variableMap: (r.variable_map as Record<string, string> | null) ?? null,
      });

    for (const r of (
      await tx.execute(
        sql`SELECT * FROM booking_financials WHERE org_id = ${orgId} AND booking_type_id IN ${ids}`,
      )
    ).rows as Raw[])
      get(r.booking_type_id).financial = {
        feeMinor: BigInt(r.fee_minor as string | number),
        taxPct: String(r.tax_pct),
        currency: s(r.currency),
        gatewaySlug: s(r.gateway_slug),
        depositMode: r.deposit_mode as 'none' | 'partial' | 'full',
        depositValueMinor: BigInt(r.deposit_value_minor as string | number),
        autoSendLink: r.auto_send_link as boolean,
        cancelFeeMinor: BigInt(r.cancel_fee_minor as string | number),
        noShowFeeMinor: BigInt(r.no_show_fee_minor as string | number),
        cancelWindowMinutes: Number(r.cancel_window_minutes),
      };

    for (const r of (
      await tx.execute(
        sql`SELECT * FROM booking_integrations WHERE org_id = ${orgId} AND booking_type_id IN ${ids}`,
      )
    ).rows as Raw[])
      get(r.booking_type_id).integration = {
        calendarId: s(r.calendar_id),
        createMeet: r.create_meet as boolean,
        spreadsheetId: s(r.spreadsheet_id),
        sheetRange: r.sheet_range as string,
      };
    return out;
  }

  async replaceRules(tx: Tx, orgId: number, typeId: number, rules: RuleRow[]): Promise<void> {
    await tx.execute(
      sql`DELETE FROM booking_availability_rules WHERE org_id = ${orgId} AND booking_type_id = ${typeId}`,
    );
    for (const r of rules)
      await tx.execute(sql`INSERT INTO booking_availability_rules (org_id, booking_type_id, weekday, start_time, end_time)
        VALUES (${orgId}, ${typeId}, ${r.weekday}, ${r.from}::time, ${r.to}::time)`);
  }

  async replaceOverrides(
    tx: Tx,
    orgId: number,
    typeId: number,
    list: OverrideRow[],
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM booking_availability_overrides WHERE org_id = ${orgId} AND booking_type_id = ${typeId}`,
    );
    for (const o of list) await this.upsertOverride(tx, orgId, typeId, o);
  }

  async upsertOverride(tx: Tx, orgId: number, typeId: number, o: OverrideRow): Promise<void> {
    await tx.execute(sql`
      INSERT INTO booking_availability_overrides (org_id, booking_type_id, date, is_closed, start_time, end_time, reason)
      VALUES (${orgId}, ${typeId}, ${o.date}::date, ${o.isClosed}, ${o.from}::time, ${o.to}::time, ${o.reason})
      ON CONFLICT (org_id, booking_type_id, date) DO UPDATE
        SET is_closed = EXCLUDED.is_closed, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, reason = EXCLUDED.reason`);
  }

  async deleteOverride(tx: Tx, orgId: number, typeId: number, date: string): Promise<boolean> {
    const res = await tx.execute(sql`DELETE FROM booking_availability_overrides
      WHERE org_id = ${orgId} AND booking_type_id = ${typeId} AND date = ${date}::date RETURNING id`);
    return res.rows.length > 0;
  }

  /** Keeps the rows named by uuid, updates them, inserts the rest, deletes the rows not named. */
  async syncQuestions(
    tx: Tx,
    orgId: number,
    typeId: number,
    list: Array<{
      uuid?: string;
      label: string;
      type: BookingQuestionType;
      options: string[] | null;
      required: boolean;
      mapToContactField: string | null;
    }>,
  ): Promise<void> {
    const keep = list.filter((q) => q.uuid).map((q) => q.uuid!);
    await tx.execute(sql`DELETE FROM booking_questions WHERE org_id = ${orgId} AND booking_type_id = ${typeId}
      ${
        keep.length > 0
          ? sql`AND uuid NOT IN (${sql.join(
              keep.map((k) => sql`${k}::uuid`),
              sql`, `,
            )})`
          : sql``
      }`);
    let i = 0;
    for (const q of list) {
      const options = q.options ? JSON.stringify(q.options) : null;
      if (q.uuid) {
        await tx.execute(sql`UPDATE booking_questions SET label = ${q.label}, type = ${q.type}, options = ${options}::jsonb,
          required = ${q.required}, map_to_contact_field = ${q.mapToContactField}, sort_order = ${i}
          WHERE org_id = ${orgId} AND booking_type_id = ${typeId} AND uuid = ${q.uuid}::uuid`);
      } else {
        await tx.execute(sql`INSERT INTO booking_questions (org_id, booking_type_id, label, type, options, required, map_to_contact_field, sort_order)
          VALUES (${orgId}, ${typeId}, ${q.label}, ${q.type}, ${options}::jsonb, ${q.required}, ${q.mapToContactField}, ${i})`);
      }
      i++;
    }
  }

  async syncReminders(
    tx: Tx,
    orgId: number,
    typeId: number,
    list: Array<{
      uuid?: string;
      offsetMinutes: number;
      label: string | null;
      isActive: boolean;
      kind: BookingReminderKind;
      channels: BookingReminderChannel[];
      subject: string | null;
      body: string | null;
      waTemplateId: number | null;
    }>,
  ): Promise<void> {
    const keep = list.filter((r) => r.uuid).map((r) => r.uuid!);
    await tx.execute(sql`DELETE FROM booking_reminders WHERE org_id = ${orgId} AND booking_type_id = ${typeId}
      ${
        keep.length > 0
          ? sql`AND uuid NOT IN (${sql.join(
              keep.map((k) => sql`${k}::uuid`),
              sql`, `,
            )})`
          : sql``
      }`);
    // The position handle follows the order of the list; uniqueness is checked at commit (deferred), so rows may swap places.
    let i = 0;
    for (const r of list) {
      if (r.uuid) {
        await tx.execute(sql`UPDATE booking_reminders SET offset_minutes = ${r.offsetMinutes}, offset_index = ${i},
          label = ${r.label}, is_active = ${r.isActive}, kind = ${r.kind}, channels = ${channelsArray(r.channels)},
          subject = ${r.subject}, body = ${r.body}, wa_template_id = ${r.waTemplateId}
          WHERE org_id = ${orgId} AND booking_type_id = ${typeId} AND uuid = ${r.uuid}::uuid`);
      } else {
        await tx.execute(sql`INSERT INTO booking_reminders (org_id, booking_type_id, offset_index, offset_minutes, label, is_active,
            kind, channels, subject, body, wa_template_id)
          VALUES (${orgId}, ${typeId}, ${i}, ${r.offsetMinutes}, ${r.label}, ${r.isActive}, ${r.kind},
            ${channelsArray(r.channels)}, ${r.subject}, ${r.body}, ${r.waTemplateId})`);
      }
      i++;
    }
  }

  async replaceTemplates(
    tx: Tx,
    orgId: number,
    typeId: number,
    list: Array<{
      event: BookingTemplateEvent;
      channel: BookingTemplateChannel;
      waTemplateId: number | null;
      plainBody: string | null;
      variableMap: Record<string, string> | null;
    }>,
  ): Promise<void> {
    await tx.execute(
      sql`DELETE FROM booking_templates WHERE org_id = ${orgId} AND booking_type_id = ${typeId}`,
    );
    for (const t of list)
      await tx.execute(sql`INSERT INTO booking_templates (org_id, booking_type_id, event, channel, wa_template_id, plain_body, variable_map)
        VALUES (${orgId}, ${typeId}, ${t.event}, ${t.channel}, ${t.waTemplateId}, ${t.plainBody},
                ${t.variableMap ? JSON.stringify(t.variableMap) : null}::jsonb)`);
  }

  async upsertFinancial(
    tx: Tx,
    orgId: number,
    typeId: number,
    f: {
      feeMinor: bigint;
      taxPct: string;
      currency: string | null;
      gatewaySlug: string | null;
      depositMode: string;
      depositValueMinor: bigint;
      autoSendLink: boolean;
      cancelFeeMinor: bigint;
      noShowFeeMinor: bigint;
      cancelWindowMinutes: number;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO booking_financials (org_id, booking_type_id, fee_minor, tax_pct, currency, gateway_slug, deposit_mode,
        deposit_value_minor, auto_send_link, cancel_fee_minor, no_show_fee_minor, cancel_window_minutes)
      VALUES (${orgId}, ${typeId}, ${f.feeMinor.toString()}::bigint, ${f.taxPct}::numeric, ${f.currency}, ${f.gatewaySlug}, ${f.depositMode},
        ${f.depositValueMinor.toString()}::bigint, ${f.autoSendLink}, ${f.cancelFeeMinor.toString()}::bigint,
        ${f.noShowFeeMinor.toString()}::bigint, ${f.cancelWindowMinutes})
      ON CONFLICT (org_id, booking_type_id) DO UPDATE SET fee_minor = EXCLUDED.fee_minor, tax_pct = EXCLUDED.tax_pct,
        currency = EXCLUDED.currency, gateway_slug = EXCLUDED.gateway_slug, deposit_mode = EXCLUDED.deposit_mode,
        deposit_value_minor = EXCLUDED.deposit_value_minor, auto_send_link = EXCLUDED.auto_send_link,
        cancel_fee_minor = EXCLUDED.cancel_fee_minor, no_show_fee_minor = EXCLUDED.no_show_fee_minor,
        cancel_window_minutes = EXCLUDED.cancel_window_minutes`);
  }

  async upsertIntegration(
    tx: Tx,
    orgId: number,
    typeId: number,
    i: {
      calendarId: string | null;
      createMeet: boolean;
      spreadsheetId: string | null;
      sheetRange: string;
    },
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO booking_integrations (org_id, booking_type_id, calendar_id, create_meet, spreadsheet_id, sheet_range)
      VALUES (${orgId}, ${typeId}, ${i.calendarId}, ${i.createMeet}, ${i.spreadsheetId}, ${i.sheetRange})
      ON CONFLICT (org_id, booking_type_id) DO UPDATE SET calendar_id = EXCLUDED.calendar_id, create_meet = EXCLUDED.create_meet,
        spreadsheet_id = EXCLUDED.spreadsheet_id, sheet_range = EXCLUDED.sheet_range`);
  }

  // --- lookups ------------------------------------------------------------------------------------------------------------

  async resolveActiveUser(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'active'`,
    );
    const r = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return r ? { id: Number(r.id), name: r.full_name } : undefined;
  }

  async resolveWaTemplates(tx: Tx, orgId: number, uuids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (uuids.length === 0) return out;
    const res = await tx.execute(sql`SELECT id, uuid FROM wa_templates WHERE org_id = ${orgId}
      AND uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    for (const r of res.rows as Raw[]) out.set(r.uuid as string, Number(r.id));
    return out;
  }

  async org(
    tx: Tx,
    orgId: number,
  ): Promise<{ name: string; slug: string; timezone: string | null; currency: string | null }> {
    const res = await tx.execute(sql`SELECT name, slug, settings ->> 'timezone' AS timezone,
      settings ->> 'currency' AS currency FROM organizations WHERE id = ${orgId}`);
    const r = res.rows[0] as Raw;
    return {
      name: r.name as string,
      slug: r.slug as string,
      timezone: s(r.timezone),
      currency: s(r.currency),
    };
  }
}
