import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** `IN (...)` lists are chunked so a big audience never builds one giant statement. */
export const CHUNK = 1_000;
export function* chunks<T>(items: readonly T[], size = CHUNK): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
const list = (values: readonly (string | number)[], cast: 'uuid' | 'bigint' | 'text') =>
  sql.join(
    values.map((v) => sql`${v}::${sql.raw(cast)}`),
    sql`, `,
  );

/**
 * The per-recipient roll-up Reference used everywhere (`WpCampaign::aggregateSelectSql`): sent includes everything past sent, a read
 * is also delivered, a reply is also sent, delivered and read. A single definition so the list, the detail and the stored
 * counters can never disagree.
 */
const AGG = sql.raw(`
  count(*) FILTER (WHERE r.status IN ('sent','delivered','read','responded') OR r.sent_at IS NOT NULL OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_sent,
  count(*) FILTER (WHERE r.status IN ('delivered','read','responded') OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_delivered,
  count(*) FILTER (WHERE r.status IN ('read','responded') OR r.read_at IS NOT NULL)::int AS a_read,
  count(*) FILTER (WHERE r.status = 'responded' OR r.responded_at IS NOT NULL)::int AS a_responded,
  count(*) FILTER (WHERE r.clicked OR r.clicked_at IS NOT NULL)::int AS a_clicked,
  count(*) FILTER (WHERE r.status = 'failed')::int AS a_failed,
  count(*) FILTER (WHERE r.status IN ('sent','delivered','read','responded','failed','unsubscribed','skipped') OR r.sent_at IS NOT NULL OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_terminal,
  count(*)::int AS a_total`);

export interface Counts {
  sent: number;
  delivered: number;
  read: number;
  responded: number;
  clicked: number;
  failed: number;
  terminal: number;
  total: number;
}

export interface CampaignRow {
  id: number;
  uuid: string;
  name: string;
  type: string;
  status: string;
  provider: string | null;
  deviceId: number | null;
  abTesting: boolean;
  abSplit: number;
  /** Encrypted. */
  customMessage: string | null;
  /** Encrypted. */
  customMessageB: string | null;
  /** Encrypted. */
  customHeader: string | null;
  /** Encrypted. */
  customFooter: string | null;
  customButtons: Array<Record<string, unknown>> | null;
  customQuickReplies: Array<Record<string, unknown>> | null;
  variableMap: Record<string, string> | null;
  customImage: string | null;
  customVideo: string | null;
  customDocument: string | null;
  templateId: number | null;
  templateUuid: string | null;
  templateName: string | null;
  templateIdA: number | null;
  templateAUuid: string | null;
  templateIdB: number | null;
  templateBUuid: string | null;
  templateOverrides: Record<string, unknown> | null;
  templateOverridesB: Record<string, unknown> | null;
  flowId: number | null;
  flowUuid: string | null;
  flowIdB: number | null;
  flowBUuid: string | null;
  useAttributes: boolean;
  trackingEnabled: boolean;
  scheduleType: string;
  sendDate: string | null;
  sendTime: string | null;
  timezone: string | null;
  repeatInterval: string | null;
  repeatUntil: string | null;
  throttleMinSec: number | null;
  throttleMaxSec: number | null;
  batchSize: number | null;
  batchPauseMin: number | null;
  dailyLimit: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  lastRunAt: Date | null;
  expiresAt: Date | null;
  totalRecipients: number;
  metaClickedCount: number;
  completedAt: Date | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
  /** Counts from the recipient rows, never from the row's own columns. */
  counts: Counts;
}

interface Raw {
  [k: string]: unknown;
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const day = (v: unknown) =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);

function toRow(r: Raw): CampaignRow {
  return {
    id: Number(r.id),
    uuid: String(r.uuid),
    name: String(r.campaign_name),
    type: String(r.campaign_type),
    status: String(r.status),
    provider: str(r.provider),
    deviceId: num(r.device_id),
    abTesting: Boolean(r.ab_testing),
    abSplit: Number(r.ab_split ?? 50),
    customMessage: str(r.custom_message),
    customMessageB: str(r.custom_message_b),
    customHeader: str(r.custom_header),
    customFooter: str(r.custom_footer),
    customButtons: (r.custom_buttons as CampaignRow['customButtons']) ?? null,
    customQuickReplies: (r.custom_quick_replies as CampaignRow['customQuickReplies']) ?? null,
    variableMap: (r.custom_variable_map as CampaignRow['variableMap']) ?? null,
    customImage: str(r.custom_image),
    customVideo: str(r.custom_video),
    customDocument: str(r.custom_document),
    templateId: num(r.template_id),
    templateUuid: str(r.template_uuid),
    templateName: str(r.template_name),
    templateIdA: num(r.template_id_a),
    templateAUuid: str(r.template_a_uuid),
    templateIdB: num(r.template_id_b),
    templateBUuid: str(r.template_b_uuid),
    templateOverrides: (r.template_overrides as CampaignRow['templateOverrides']) ?? null,
    templateOverridesB: (r.template_overrides_b as CampaignRow['templateOverridesB']) ?? null,
    flowId: num(r.flow_id),
    flowUuid: str(r.flow_uuid),
    flowIdB: num(r.flow_id_b),
    flowBUuid: str(r.flow_b_uuid),
    useAttributes: Boolean(r.use_attributes),
    trackingEnabled: Boolean(r.tracking_enabled),
    scheduleType: String(r.schedule_type),
    sendDate: day(r.send_date),
    sendTime: str(r.send_time),
    timezone: str(r.timezone),
    repeatInterval: str(r.repeat_interval),
    repeatUntil: day(r.repeat_until),
    throttleMinSec: num(r.throttle_min_sec),
    throttleMaxSec: num(r.throttle_max_sec),
    batchSize: num(r.batch_size),
    batchPauseMin: num(r.batch_pause_min),
    dailyLimit: num(r.daily_limit),
    windowStart: str(r.window_start),
    windowEnd: str(r.window_end),
    lastRunAt: date(r.last_run_at),
    expiresAt: date(r.expires_at),
    totalRecipients: Number(r.total_recipients ?? 0),
    metaClickedCount: Number(r.meta_clicked_count ?? 0),
    completedAt: date(r.completed_at),
    createdBy: num(r.created_by),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    rowVersion: Number(r.row_version),
    counts: {
      sent: Number(r.a_sent ?? 0),
      delivered: Number(r.a_delivered ?? 0),
      read: Number(r.a_read ?? 0),
      responded: Number(r.a_responded ?? 0),
      clicked: Number(r.a_clicked ?? 0),
      failed: Number(r.a_failed ?? 0),
      terminal: Number(r.a_terminal ?? 0),
      total: Number(r.a_total ?? 0),
    },
  };
}

const SELECT = sql`
  SELECT c.*, t.uuid AS template_uuid, t.template_name, ta.uuid AS template_a_uuid, tb.uuid AS template_b_uuid,
         f.uuid AS flow_uuid, fb.uuid AS flow_b_uuid, agg.*
  FROM wpcampaigns c
  LEFT JOIN wa_templates t  ON t.org_id  = c.org_id AND t.id  = c.template_id
  LEFT JOIN wa_templates ta ON ta.org_id = c.org_id AND ta.id = c.template_id_a
  LEFT JOIN wa_templates tb ON tb.org_id = c.org_id AND tb.id = c.template_id_b
  LEFT JOIN flows f  ON f.org_id  = c.org_id AND f.id  = c.flow_id
  LEFT JOIN flows fb ON fb.org_id = c.org_id AND fb.id = c.flow_id_b
  LEFT JOIN LATERAL (
    SELECT ${AGG} FROM wp_campaign_contacts r WHERE r.org_id = c.org_id AND r.campaign_id = c.id
  ) agg ON true`;

export interface NewCampaign {
  name: string;
  type: string;
  status: string;
  provider: string | null;
  deviceId: number | null;
  abTesting: boolean;
  abSplit: number;
  customMessage: string | null;
  customMessageB: string | null;
  customHeader: string | null;
  customFooter: string | null;
  customButtons: unknown[] | null;
  customQuickReplies: unknown[] | null;
  variableMap: Record<string, string> | null;
  customImage: string | null;
  customVideo: string | null;
  customDocument: string | null;
  templateId: number | null;
  templateIdA: number | null;
  templateIdB: number | null;
  templateOverrides: Record<string, unknown> | null;
  templateOverridesB: Record<string, unknown> | null;
  flowId: number | null;
  flowIdB: number | null;
  useAttributes: boolean;
  trackingEnabled: boolean;
  scheduleType: string;
  sendDate: string | null;
  sendTime: string | null;
  timezone: string;
  repeatInterval: string | null;
  repeatUntil: string | null;
  expiresAt: Date | null;
  throttleMinSec: number | null;
  throttleMaxSec: number | null;
  batchSize: number | null;
  batchPauseMin: number | null;
  dailyLimit: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  totalRecipients: number;
  createdBy: number | null;
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export interface ClaimedRecipient {
  id: number;
  contactId: number;
  variant: string | null;
  attempts: number;
  phone: string | null;
  countryCode: string | null;
}

export interface RecipientRow {
  id: number;
  uuid: string;
  contactId: number | null;
  contactUuid: string | null;
  variant: string | null;
  status: string;
  sendAttempts: number;
  nextAttemptAt: Date | null;
  phone: string | null;
  name: string | null;
  providerMessageId: string | null;
  clicked: boolean;
  clickCount: number;
  clickedAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  respondedAt: Date | null;
  response: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `wpcampaigns` and `wp_campaign_contacts`, always inside the caller's tenant transaction. */
@Injectable()
export class CampaignsRepository {
  // -------------------------------------------------------------- campaigns

  async count(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM wpcampaigns WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<CampaignRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<CampaignRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE c.org_id = ${orgId} AND c.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /** The row locked, so a concurrent edit, action or run waits for this decision. */
  async lock(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; status: string } | undefined> {
    const res = await tx.execute(sql`
      SELECT id, status FROM wpcampaigns WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    const r = res.rows[0] as { id: number | string; status: string } | undefined;
    return r ? { id: Number(r.id), status: r.status } : undefined;
  }

  async insert(tx: Tx, orgId: number, v: NewCampaign): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO wpcampaigns (
        org_id, campaign_name, campaign_type, status, provider, device_id, ab_testing, ab_split,
        custom_message, custom_message_b, custom_header, custom_footer, custom_buttons, custom_quick_replies,
        custom_variable_map, custom_image, custom_video, custom_document,
        template_id, template_id_a, template_id_b, template_overrides, template_overrides_b, flow_id, flow_id_b,
        use_attributes, tracking_enabled, schedule_type, send_date, send_time, timezone, repeat_interval, repeat_until,
        expires_at, throttle_min_sec, throttle_max_sec, batch_size, batch_pause_min, daily_limit, window_start, window_end,
        total_recipients, created_by)
      VALUES (
        ${orgId}, ${v.name}, ${v.type}, ${v.status}, ${v.provider}, ${v.deviceId}, ${v.abTesting}, ${v.abSplit},
        ${v.customMessage}, ${v.customMessageB}, ${v.customHeader}, ${v.customFooter},
        ${json(v.customButtons)}::jsonb, ${json(v.customQuickReplies)}::jsonb, ${json(v.variableMap)}::jsonb,
        ${v.customImage}, ${v.customVideo}, ${v.customDocument},
        ${v.templateId}, ${v.templateIdA}, ${v.templateIdB}, ${json(v.templateOverrides)}::jsonb,
        ${json(v.templateOverridesB)}::jsonb, ${v.flowId}, ${v.flowIdB},
        ${v.useAttributes}, ${v.trackingEnabled}, ${v.scheduleType}, ${v.sendDate}::date, ${v.sendTime}::time,
        ${v.timezone}, ${v.repeatInterval}, ${v.repeatUntil}::date,
        ${v.expiresAt ? v.expiresAt.toISOString() : null}::timestamptz,
        ${v.throttleMinSec}, ${v.throttleMaxSec}, ${v.batchSize}, ${v.batchPauseMin}, ${v.dailyLimit},
        ${v.windowStart}, ${v.windowEnd}, ${v.totalRecipients}, ${v.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Replaces every editable field. The media columns are only touched when `media` is given. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: Omit<
      NewCampaign,
      'status' | 'totalRecipients' | 'createdBy' | 'customImage' | 'customVideo' | 'customDocument'
    > & {
      status: string | null;
      media: { image: string | null; video: string | null; document: string | null } | null;
      overrides: boolean;
      overridesB: boolean;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wpcampaigns SET
        campaign_name = ${v.name}, campaign_type = ${v.type}, status = coalesce(${v.status}, status),
        provider = ${v.provider}, device_id = ${v.deviceId}, ab_testing = ${v.abTesting}, ab_split = ${v.abSplit},
        custom_message = ${v.customMessage}, custom_message_b = ${v.customMessageB}, custom_header = ${v.customHeader},
        custom_footer = ${v.customFooter}, custom_buttons = ${json(v.customButtons)}::jsonb,
        custom_quick_replies = ${json(v.customQuickReplies)}::jsonb, custom_variable_map = ${json(v.variableMap)}::jsonb,
        template_id = ${v.templateId}, template_id_a = ${v.templateIdA}, template_id_b = ${v.templateIdB},
        template_overrides = CASE WHEN ${v.overrides} THEN ${json(v.templateOverrides)}::jsonb ELSE template_overrides END,
        template_overrides_b = CASE WHEN ${v.overridesB} THEN ${json(v.templateOverridesB)}::jsonb ELSE template_overrides_b END,
        flow_id = ${v.flowId}, flow_id_b = ${v.flowIdB}, use_attributes = ${v.useAttributes},
        tracking_enabled = ${v.trackingEnabled}, schedule_type = ${v.scheduleType}, send_date = ${v.sendDate}::date,
        send_time = ${v.sendTime}::time, timezone = ${v.timezone}, repeat_interval = ${v.repeatInterval},
        repeat_until = ${v.repeatUntil}::date, expires_at = ${v.expiresAt ? v.expiresAt.toISOString() : null}::timestamptz,
        throttle_min_sec = ${v.throttleMinSec}, throttle_max_sec = ${v.throttleMaxSec}, batch_size = ${v.batchSize},
        batch_pause_min = ${v.batchPauseMin}, daily_limit = ${v.dailyLimit}, window_start = ${v.windowStart},
        window_end = ${v.windowEnd},
        custom_image = CASE WHEN ${v.media !== null} THEN ${v.media?.image ?? null} ELSE custom_image END,
        custom_video = CASE WHEN ${v.media !== null} THEN ${v.media?.video ?? null} ELSE custom_video END,
        custom_document = CASE WHEN ${v.media !== null} THEN ${v.media?.document ?? null} ELSE custom_document END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setStatus(
    tx: Tx,
    orgId: number,
    id: number,
    status: string,
    o: { completed?: boolean; reopen?: boolean; lastRun?: boolean } = {},
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wpcampaigns SET status = ${status},
        completed_at = CASE WHEN ${o.completed === true} THEN now() WHEN ${o.reopen === true} THEN NULL ELSE completed_at END,
        last_run_at = CASE WHEN ${o.lastRun === true} THEN now() ELSE last_run_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setSchedule(
    tx: Tx,
    orgId: number,
    id: number,
    v: { scheduleType?: string; sendDate: string; sendTime: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wpcampaigns SET schedule_type = coalesce(${v.scheduleType ?? null}, schedule_type),
             send_date = ${v.sendDate}::date, send_time = ${v.sendTime}::time
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setTotal(tx: Tx, orgId: number, id: number, total: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wpcampaigns SET total_recipients = ${total} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Stores the roll-up of the recipient rows on the campaign, for the screens that read the columns. */
  async recount(tx: Tx, orgId: number, id: number): Promise<Counts> {
    const res = await tx.execute(sql`
      SELECT ${AGG} FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND r.campaign_id = ${id}`);
    const a = res.rows[0] as Raw;
    const counts: Counts = {
      sent: Number(a.a_sent),
      delivered: Number(a.a_delivered),
      read: Number(a.a_read),
      responded: Number(a.a_responded),
      clicked: Number(a.a_clicked),
      failed: Number(a.a_failed),
      terminal: Number(a.a_terminal),
      total: Number(a.a_total),
    };
    await tx.execute(sql`
      UPDATE wpcampaigns SET sent_count = ${counts.sent}, delivered_count = ${counts.delivered}, read_count = ${counts.read},
             responded_count = ${counts.responded}, clicked_count = ${counts.clicked}, failed_count = ${counts.failed}
      WHERE org_id = ${orgId} AND id = ${id}`);
    return counts;
  }

  async remove(tx: Tx, orgId: number, ids: readonly number[]): Promise<void> {
    for (const part of chunks(ids)) {
      await tx.execute(
        sql`DELETE FROM wpcampaigns WHERE org_id = ${orgId} AND id IN (${list(part, 'bigint')})`,
      );
    }
  }

  async idsByUuid(tx: Tx, orgId: number, uuids: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const part of chunks(uuids)) {
      const res = await tx.execute(
        sql`SELECT id, uuid FROM wpcampaigns WHERE org_id = ${orgId} AND uuid IN (${list(part, 'uuid')})`,
      );
      for (const r of res.rows as Array<{ id: number | string; uuid: string }>)
        out.set(r.uuid, Number(r.id));
    }
    return out;
  }

  // -------------------------------------------------------------- the run

  async liveStatus(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT status FROM wpcampaigns WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as { status: string } | undefined;
    return r ? r.status : null;
  }

  /** The run is alive: the sweeper leaves a campaign alone while this is recent. */
  async touch(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wpcampaigns SET last_run_at = now() WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * Recipients that opted out are stamped `unsubscribed` (flag set) so the run can finish and the opt-outs tab shows them; one
   * contact per normalized phone keeps the first, the later rows are `skipped` (not sent, not a failure).
   */
  async screenRecipients(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ optedOut: number; duplicates: number }> {
    const settled = sql`('sent','delivered','read','responded','unsubscribed','skipped')`;
    const out = await tx.execute(sql`
      UPDATE wp_campaign_contacts r SET status = 'unsubscribed', is_unsubscribed = true, unsubscribed = true
      FROM contacts c
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${id} AND c.org_id = r.org_id AND c.id = r.contact_id
        AND c.is_unsubscribed AND r.status NOT IN ${settled}
      RETURNING r.id`);
    const dup = await tx.execute(sql`
      UPDATE wp_campaign_contacts r SET status = 'skipped', error_message = 'duplicate number — already sent this run'
      FROM (
        SELECT x.id, row_number() OVER (PARTITION BY x.digits ORDER BY x.id) AS rn
        FROM (
          SELECT r2.id, regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') AS digits
          FROM wp_campaign_contacts r2 JOIN contacts c ON c.org_id = r2.org_id AND c.id = r2.contact_id
          WHERE r2.org_id = ${orgId} AND r2.campaign_id = ${id} AND r2.status NOT IN ${settled}
        ) x WHERE x.digits <> ''
      ) d
      WHERE r.org_id = ${orgId} AND r.id = d.id AND d.rn > 1
      RETURNING r.id`);
    return { optedOut: out.rows.length, duplicates: dup.rows.length };
  }

  /**
   * The next recipients to send: queued ones, and failed ones with attempts left whose next attempt is due. They are marked
   * `pending` (claimed) in the same statement, so two workers never take the same row. Oldest first.
   */
  async claim(
    tx: Tx,
    orgId: number,
    id: number,
    maxAttempts: number,
    limit: number,
  ): Promise<ClaimedRecipient[]> {
    const res = await tx.execute(sql`
      WITH picked AS MATERIALIZED (
        SELECT r.id FROM wp_campaign_contacts r
        WHERE r.org_id = ${orgId} AND r.campaign_id = ${id}
          AND (r.status = 'queued'
               OR (r.status = 'failed' AND r.send_attempts < ${maxAttempts}
                   AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())))
        ORDER BY r.id LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE wp_campaign_contacts r SET status = 'pending'
      FROM picked, contacts c
      WHERE r.org_id = ${orgId} AND r.id = picked.id AND c.org_id = r.org_id AND c.id = r.contact_id
      RETURNING r.id, r.contact_id, r.variant, r.send_attempts, c.phone, c.country_code`);
    return (res.rows as Raw[])
      .map((r) => ({
        id: Number(r.id),
        contactId: Number(r.contact_id),
        variant: str(r.variant),
        attempts: Number(r.send_attempts ?? 0),
        phone: str(r.phone),
        countryCode: str(r.country_code),
      }))
      .sort((a, b) => a.id - b.id);
  }

  async markSent(
    tx: Tx,
    orgId: number,
    rowId: number,
    providerMessageId: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = 'sent', sent_at = now(), whatsapp_message_id = ${providerMessageId},
             error_message = NULL, next_attempt_at = NULL
      WHERE org_id = ${orgId} AND id = ${rowId}`);
  }

  async markFailed(
    tx: Tx,
    orgId: number,
    rowId: number,
    v: { attempts: number; nextAttemptAt: Date | null; error: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = 'failed', send_attempts = ${v.attempts},
             next_attempt_at = ${v.nextAttemptAt ? v.nextAttemptAt.toISOString() : null}::timestamptz,
             error_message = ${v.error.slice(0, 191)}
      WHERE org_id = ${orgId} AND id = ${rowId}`);
  }

  /** A row put back for a later run (nothing was sent): the operator halted, or the window closed. */
  async release(tx: Tx, orgId: number, rowId: number, status: string): Promise<void> {
    await tx.execute(
      sql`UPDATE wp_campaign_contacts SET status = ${status} WHERE org_id = ${orgId} AND id = ${rowId}`,
    );
  }

  /** Rows every recipient not yet sent becomes failed at the cap (the campaign ended before they were reached). */
  async expireUnsent(
    tx: Tx,
    orgId: number,
    id: number,
    maxAttempts: number,
    hours: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = 'failed', send_attempts = ${maxAttempts}, next_attempt_at = NULL,
             error_message = ${`Not sent — campaign ended after its ${hours}h send window (auto-expired)`}
      WHERE org_id = ${orgId} AND campaign_id = ${id}
        AND status NOT IN ('sent','delivered','read','responded','unsubscribed')`);
  }

  async firstSentAt(tx: Tx, orgId: number, id: number): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT min(sent_at) AS at FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${id} AND sent_at IS NOT NULL`);
    const r = res.rows[0] as { at: string | Date | null };
    return r.at ? new Date(r.at) : null;
  }

  /** What is left after a run: rows not sent (a skipped duplicate is final), and of those the ones with attempts left (and when the earliest is due). */
  async remaining(
    tx: Tx,
    orgId: number,
    id: number,
    maxAttempts: number,
  ): Promise<{ remaining: number; retryable: number; nextRetryAt: Date | null }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS remaining,
             count(*) FILTER (WHERE send_attempts < ${maxAttempts})::int AS retryable,
             min(next_attempt_at) FILTER (WHERE send_attempts < ${maxAttempts}) AS next_at
      FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${id} AND status NOT IN ('sent','delivered','read','responded','unsubscribed','skipped')`);
    const r = res.rows[0] as {
      remaining: number;
      retryable: number;
      next_at: string | Date | null;
    };
    return {
      remaining: Number(r.remaining),
      retryable: Number(r.retryable),
      nextRetryAt: r.next_at ? new Date(r.next_at) : null,
    };
  }

  /** A fresh cadence: every recipient is queued again with its retries and backoff cleared. */
  async requeueAll(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = 'queued', send_attempts = 0, next_attempt_at = NULL
      WHERE org_id = ${orgId} AND campaign_id = ${id}`);
  }

  async firstContactUuid(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT uuid FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    const r = res.rows[0] as { uuid: string } | undefined;
    return r?.uuid ?? null;
  }

  // -------------------------------------------------------------- reports and callbacks

  async recipientOf(
    tx: Tx,
    orgId: number,
    campaignId: number,
    contactId: number,
  ): Promise<
    | {
        id: number;
        status: string;
        sentAt: Date | null;
        deliveredAt: Date | null;
        readAt: Date | null;
      }
    | undefined
  > {
    const res = await tx.execute(sql`
      SELECT id, status, sent_at, delivered_at, read_at FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND contact_id = ${contactId}
      ORDER BY id LIMIT 1 FOR UPDATE`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? {
          id: Number(r.id),
          status: String(r.status),
          sentAt: date(r.sent_at),
          deliveredAt: date(r.delivered_at),
          readAt: date(r.read_at),
        }
      : undefined;
  }

  /** Writes a reported status. Times are set once (the first report wins), the error and message id only when given. */
  async applyReport(
    tx: Tx,
    orgId: number,
    rowId: number,
    v: {
      status: string;
      error?: string | null;
      providerMessageId?: string | null;
      variant?: string | null;
      sentAt?: Date | null;
      deliveredAt?: Date | null;
      readAt?: Date | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = ${v.status},
        error_message = coalesce(${v.error ? v.error.slice(0, 1024) : null}, error_message),
        whatsapp_message_id = coalesce(${v.providerMessageId ?? null}, whatsapp_message_id),
        variant = coalesce(${v.variant ? v.variant.slice(0, 8) : null}, variant),
        sent_at = coalesce(sent_at, ${v.sentAt ? v.sentAt.toISOString() : null}::timestamptz),
        delivered_at = coalesce(delivered_at, ${v.deliveredAt ? v.deliveredAt.toISOString() : null}::timestamptz),
        read_at = coalesce(read_at, ${v.readAt ? v.readAt.toISOString() : null}::timestamptz)
      WHERE org_id = ${orgId} AND id = ${rowId}`);
  }

  async setResponse(
    tx: Tx,
    orgId: number,
    campaignId: number,
    contactId: number,
    response: string,
    at: Date,
  ): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE wp_campaign_contacts SET response = ${response.slice(0, 4096)}, responded_at = ${at.toISOString()}::timestamptz
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND contact_id = ${contactId}
      RETURNING id`);
    return res.rows.length;
  }

  /** The contact whose number is `digits`, or ends with its last ten digits. */
  async contactByPhone(
    tx: Tx,
    orgId: number,
    digits: string,
  ): Promise<{ id: number; unsubscribed: boolean } | null> {
    const tail = digits.slice(-10);
    const res = await tx.execute(sql`
      SELECT id, is_unsubscribed FROM contacts
      WHERE org_id = ${orgId}
        AND (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = ${digits}
             OR (${tail} <> '' AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE ${`%${tail}`}))
      ORDER BY (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = ${digits}) DESC, id LIMIT 1`);
    const r = res.rows[0] as { id: number | string; is_unsubscribed: boolean } | undefined;
    return r ? { id: Number(r.id), unsubscribed: r.is_unsubscribed } : null;
  }

  /** The row of this campaign for a contact, else the row whose own phone matches. */
  async unsubscribeRow(
    tx: Tx,
    orgId: number,
    campaignId: number,
    contactId: number | null,
    digits: string,
  ): Promise<{ id: number; contactId: number | null } | undefined> {
    const tail = digits.slice(-10);
    const res = await tx.execute(sql`
      SELECT id, contact_id FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId}
        AND ((${contactId}::bigint IS NOT NULL AND contact_id = ${contactId}::bigint)
             OR regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g') = ${digits}
             OR (${tail} <> '' AND regexp_replace(coalesce(phone_number, ''), '[^0-9]', '', 'g') LIKE ${`%${tail}`}))
      ORDER BY id LIMIT 1 FOR UPDATE`);
    const r = res.rows[0] as
      { id: number | string; contact_id: number | string | null } | undefined;
    return r ? { id: Number(r.id), contactId: num(r.contact_id) } : undefined;
  }

  async markUnsubscribed(tx: Tx, orgId: number, rowId: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wp_campaign_contacts SET status = 'unsubscribed', is_unsubscribed = true, unsubscribed = true, unsubscribed_at = now()
      WHERE org_id = ${orgId} AND id = ${rowId}`);
  }

  /** Flips the contact's workspace-level flag so other campaigns and broadcasts skip it. Returns whether it changed. */
  async optOutContact(tx: Tx, orgId: number, contactId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE contacts SET is_unsubscribed = true, unsubscribed_at = coalesce(unsubscribed_at, now())
      WHERE org_id = ${orgId} AND id = ${contactId} AND NOT is_unsubscribed
      RETURNING id`);
    return res.rows.length > 0;
  }

  async contactPhone(tx: Tx, orgId: number, contactId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT phone FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    return (res.rows[0] as { phone: string | null } | undefined)?.phone ?? null;
  }

  // -------------------------------------------------------------- list and tiles

  /** All of the workspace's campaigns with their counts, newest first: the list filters and counts it in memory like Reference. */
  async listAll(tx: Tx, orgId: number): Promise<CampaignRow[]> {
    const res = await tx.execute(sql`${SELECT} WHERE c.org_id = ${orgId} ORDER BY c.id DESC`);
    return (res.rows as Raw[]).map(toRow);
  }

  async templateHealth(tx: Tx, orgId: number): Promise<{ total: number; approved: number }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status IN ('approved', 'public'))::int AS approved
      FROM wa_templates WHERE org_id = ${orgId}`);
    const r = res.rows[0] as { total: number; approved: number };
    return { total: Number(r.total), approved: Number(r.approved) };
  }

  async deviceHealth(tx: Tx, orgId: number): Promise<{ total: number; connected: number }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM devices WHERE org_id = ${orgId}) +
             (SELECT count(*) FROM wa_provider_configs WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio')) AS total,
             (SELECT count(*) FROM devices WHERE org_id = ${orgId} AND status = 'connected') +
             (SELECT count(*) FROM wa_provider_configs WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') AND status = 'connected') AS connected`);
    const r = res.rows[0] as { total: number | string; connected: number | string };
    return { total: Number(r.total), connected: Number(r.connected) };
  }

  // -------------------------------------------------------------- audience

  /** Ids of the contacts named by uuid, in the order sent. Another organization's ids are dropped. */
  async contactIdsByUuid(tx: Tx, orgId: number, uuids: readonly string[]): Promise<number[]> {
    const byUuid = new Map<string, number>();
    for (const part of chunks(uuids)) {
      const res = await tx.execute(
        sql`SELECT id, uuid FROM contacts WHERE org_id = ${orgId} AND uuid IN (${list(part, 'uuid')})`,
      );
      for (const r of res.rows as Array<{ id: number | string; uuid: string }>)
        byUuid.set(r.uuid, Number(r.id));
    }
    return uuids.flatMap((u) => (byUuid.has(u) ? [byUuid.get(u)!] : []));
  }

  async groupMemberIds(tx: Tx, orgId: number, groupUuids: readonly string[]): Promise<number[]> {
    if (groupUuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT DISTINCT m.contact_id AS id
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      WHERE m.org_id = ${orgId} AND g.uuid IN (${list(groupUuids, 'uuid')})
      ORDER BY m.contact_id`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /**
   * Contacts carrying any of the tags: the contact's own tags, and the contacts of conversations carrying them (Reference's inbox tags
   * live on conversations), mapped by contact id or by phone digits.
   */
  async tagMemberIds(tx: Tx, orgId: number, tagUuids: readonly string[]): Promise<number[]> {
    if (tagUuids.length === 0) return [];
    const res = await tx.execute(sql`
      WITH picked AS (SELECT id FROM tags WHERE org_id = ${orgId} AND uuid IN (${list(tagUuids, 'uuid')}))
      SELECT DISTINCT id FROM (
        SELECT ct.contact_id AS id FROM contact_tags ct JOIN picked p ON p.id = ct.tag_id WHERE ct.org_id = ${orgId}
        UNION
        SELECT c.contact_id AS id FROM conversation_tag cvt
          JOIN picked p ON p.id = cvt.tag_id
          JOIN conversations c ON c.org_id = cvt.org_id AND c.id = cvt.conversation_id
          WHERE cvt.org_id = ${orgId} AND c.contact_id IS NOT NULL
        UNION
        SELECT k.id FROM conversation_tag cvt
          JOIN picked p ON p.id = cvt.tag_id
          JOIN conversations c ON c.org_id = cvt.org_id AND c.id = cvt.conversation_id
          JOIN contacts k ON k.org_id = c.org_id
            AND regexp_replace(coalesce(k.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(c.contact_digits, ''), '[^0-9]', '', 'g')
          WHERE cvt.org_id = ${orgId} AND coalesce(c.contact_digits, '') <> ''
      ) x ORDER BY id`);
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /** Of these contact ids, the ones that exist here, are not archived and have not opted out. */
  async sendableIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<Set<number>> {
    const ok = new Set<number>();
    for (const part of chunks(ids)) {
      const res = await tx.execute(sql`
        SELECT id FROM contacts
        WHERE org_id = ${orgId} AND id IN (${list(part, 'bigint')}) AND NOT is_unsubscribed AND NOT is_archived`);
      for (const r of res.rows as Array<{ id: number | string }>) ok.add(Number(r.id));
    }
    return ok;
  }

  /** The contact with this phone (digits compared), else a new one; CSV attributes are merged into its data. */
  async rememberPhone(
    tx: Tx,
    orgId: number,
    userId: number | null,
    digits: string,
    name: string,
    attrs: Record<string, string>,
  ): Promise<number> {
    const found = await tx.execute(sql`
      SELECT id FROM contacts
      WHERE org_id = ${orgId} AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = ${digits}
      ORDER BY id LIMIT 1`);
    let id: number;
    const hit = found.rows[0] as { id: number | string } | undefined;
    if (hit) id = Number(hit.id);
    else {
      const ins = await tx.execute(sql`
        INSERT INTO contacts (org_id, name, phone, created_by)
        VALUES (${orgId}, ${name}, ${`+${digits}`}, ${userId})
        RETURNING id`);
      id = Number((ins.rows[0] as { id: number | string }).id);
    }
    if (Object.keys(attrs).length > 0) {
      await tx.execute(sql`
        UPDATE contacts SET data = coalesce(data, '{}'::jsonb) || ${JSON.stringify(attrs)}::jsonb
        WHERE org_id = ${orgId} AND id = ${id}`);
    }
    return id;
  }

  /** Of these contact ids, the ones that exist here and are not archived (opted-out ones stay: the run stamps them). */
  async liveIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<Set<number>> {
    const ok = new Set<number>();
    for (const part of chunks(ids)) {
      const res = await tx.execute(sql`
        SELECT id FROM contacts WHERE org_id = ${orgId} AND id IN (${list(part, 'bigint')}) AND NOT is_archived`);
      for (const r of res.rows as Array<{ id: number | string }>) ok.add(Number(r.id));
    }
    return ok;
  }

  /** The local approval status of a template of this organization (`approved`, `public`, ...), null when it is not found. */
  async templateStatus(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT status FROM wa_templates WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as { status: string | null } | undefined;
    return r ? (r.status ?? '') : null;
  }

  /** The id of a flow of this organization, by uuid. */
  async flowId(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM flows WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : null;
  }

  // -------------------------------------------------------------- recipients

  async insertRecipients(
    tx: Tx,
    orgId: number,
    campaignId: number,
    rows: ReadonlyArray<{ contactId: number; variant: string | null }>,
  ): Promise<void> {
    for (const part of chunks(rows, CHUNK)) {
      await tx.execute(sql`
        INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status, variant)
        VALUES ${sql.join(
          part.map((r) => sql`(${orgId}, ${campaignId}, ${r.contactId}, 'queued', ${r.variant})`),
          sql`, `,
        )}`);
    }
  }

  /**
   * Puts the targeted recipients back to `queued` and clears what the earlier send left (sent time, message id, error, attempts).
   * Scope `failed` is the failed rows, `all` every row, `selected` the rows of the given contacts. Returns how many were reset.
   */
  async resetForResend(
    tx: Tx,
    orgId: number,
    campaignId: number,
    scope: 'failed' | 'all' | 'selected',
    contactIds: readonly number[],
  ): Promise<number> {
    const scopeSql =
      scope === 'failed'
        ? sql`AND status = 'failed'`
        : scope === 'selected'
          ? sql`AND contact_id IN (${list(contactIds.length ? contactIds : [0], 'bigint')})`
          : sql``;
    const res = await tx.execute(sql`
      UPDATE wp_campaign_contacts
      SET status = 'queued', sent_at = NULL, whatsapp_message_id = NULL, error_message = NULL, send_attempts = 0,
          next_attempt_at = NULL
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} ${scopeSql}
      RETURNING id`);
    return res.rows.length;
  }

  async deleteRecipients(tx: Tx, orgId: number, campaignId: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId}`,
    );
  }

  async recipientContactIds(tx: Tx, orgId: number, campaignId: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT c.uuid FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId} ORDER BY r.id`);
    return (res.rows as Array<{ uuid: string }>).map((r) => r.uuid);
  }

  async recipientsPage(
    tx: Tx,
    orgId: number,
    campaignId: number,
    o: { status?: string; q: string; limit: number; offset: number },
  ): Promise<{ rows: RecipientRow[]; total: number }> {
    const filters: SQL[] = [sql`r.org_id = ${orgId}`, sql`r.campaign_id = ${campaignId}`];
    if (o.status) filters.push(sql`r.status = ${o.status}`);
    if (o.q !== '') {
      const like = `%${o.q.replace(/[\\%_]/g, '\\$&')}%`;
      filters.push(
        sql`(coalesce(r.recipient_name, c.name, '') ILIKE ${like} OR coalesce(r.phone_number, c.phone, '') ILIKE ${like})`,
      );
    }
    const where = sql.join(filters, sql` AND `);
    const total = await tx.execute(sql`
      SELECT count(*)::int AS n FROM wp_campaign_contacts r
      LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id WHERE ${where}`);
    const res = await tx.execute(sql`
      ${RECIPIENT_SELECT} WHERE ${where} ORDER BY r.id DESC LIMIT ${o.limit} OFFSET ${o.offset}`);
    return {
      rows: (res.rows as Raw[]).map(toRecipient),
      total: Number((total.rows[0] as { n: number }).n),
    };
  }

  /** Every recipient, newest first, for the CSV export (read in pages by the caller). */
  async recipientsAfter(
    tx: Tx,
    orgId: number,
    campaignId: number,
    beforeId: number | null,
    limit: number,
  ): Promise<RecipientRow[]> {
    const res = await tx.execute(sql`
      ${RECIPIENT_SELECT}
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId}
        AND (${beforeId}::bigint IS NULL OR r.id < ${beforeId}::bigint)
      ORDER BY r.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toRecipient);
  }

  async statusBreakdown(
    tx: Tx,
    orgId: number,
    campaignId: number,
  ): Promise<Array<{ status: string; count: number }>> {
    const res = await tx.execute(sql`
      SELECT status, count(*)::int AS count FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} GROUP BY status ORDER BY count DESC`);
    return (res.rows as Array<{ status: string; count: number }>).map((r) => ({
      status: r.status,
      count: Number(r.count),
    }));
  }

  async variantBreakdown(tx: Tx, orgId: number, campaignId: number) {
    const res = await tx.execute(sql`
      SELECT coalesce(r.variant, 'A') AS variant, ${AGG}
      FROM wp_campaign_contacts r WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId}
      GROUP BY coalesce(r.variant, 'A') ORDER BY 1`);
    return (res.rows as Raw[]).map((r) => ({
      variant: String(r.variant),
      recipients: Number(r.a_total),
      sent: Number(r.a_sent),
      delivered: Number(r.a_delivered),
      read: Number(r.a_read),
      replies: Number(r.a_responded),
      clicks: Number(r.a_clicked),
    }));
  }

  /** Sends and replies per hour of day in the campaign's zone. */
  async hourly(tx: Tx, orgId: number, campaignId: number, zone: string) {
    const res = await tx.execute(sql`
      SELECT h.hour,
             count(*) FILTER (WHERE r.sent_at IS NOT NULL AND extract(hour FROM r.sent_at AT TIME ZONE ${zone}) = h.hour)::int AS sent,
             count(*) FILTER (WHERE r.responded_at IS NOT NULL AND extract(hour FROM r.responded_at AT TIME ZONE ${zone}) = h.hour)::int AS replies
      FROM generate_series(0, 23) AS h(hour)
      LEFT JOIN wp_campaign_contacts r ON r.org_id = ${orgId} AND r.campaign_id = ${campaignId}
      GROUP BY h.hour ORDER BY h.hour`);
    return (res.rows as Array<{ hour: number; sent: number; replies: number }>).map((r) => ({
      hour: Number(r.hour),
      sent: Number(r.sent),
      replies: Number(r.replies),
    }));
  }

  /** Messages per day in the campaign's zone: sent, delivered, read and replies. */
  async daily(tx: Tx, orgId: number, campaignId: number, zone: string) {
    const res = await tx.execute(sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
             sum(d.sent)::int AS sent, sum(d.delivered)::int AS delivered, sum(d.read)::int AS read, sum(d.replies)::int AS replies
      FROM (
        SELECT (sent_at AT TIME ZONE ${zone})::date AS day, 1 AS sent, 0 AS delivered, 0 AS read, 0 AS replies
          FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND sent_at IS NOT NULL
        UNION ALL
        SELECT (delivered_at AT TIME ZONE ${zone})::date, 0, 1, 0, 0
          FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND delivered_at IS NOT NULL
        UNION ALL
        SELECT (read_at AT TIME ZONE ${zone})::date, 0, 0, 1, 0
          FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND read_at IS NOT NULL
        UNION ALL
        SELECT (responded_at AT TIME ZONE ${zone})::date, 0, 0, 0, 1
          FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND responded_at IS NOT NULL
      ) d GROUP BY d.day ORDER BY d.day`);
    return (res.rows as Array<Record<string, number | string>>).map((r) => ({
      date: String(r.date),
      sent: Number(r.sent),
      delivered: Number(r.delivered),
      read: Number(r.read),
      replies: Number(r.replies),
    }));
  }

  async failures(tx: Tx, orgId: number, campaignId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT uuid, error_message, updated_at FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND status = 'failed' AND error_message IS NOT NULL
      ORDER BY id DESC LIMIT ${limit}`);
    return (
      res.rows as Array<{ uuid: string; error_message: string; updated_at: string | Date }>
    ).map((r) => ({ id: r.uuid, error: r.error_message, at: new Date(r.updated_at) }));
  }

  async failureSummary(tx: Tx, orgId: number, campaignId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT error_message AS error, count(*)::int AS count FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND status = 'failed' AND error_message IS NOT NULL
      GROUP BY error_message ORDER BY count DESC LIMIT ${limit}`);
    return (res.rows as Array<{ error: string; count: number }>).map((r) => ({
      error: r.error,
      count: Number(r.count),
    }));
  }

  async replies(tx: Tx, orgId: number, campaignId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT c.uuid AS contact_uuid, coalesce(r.recipient_name, c.name, '') AS name,
             coalesce(r.phone_number, c.phone, '') AS phone, coalesce(r.response, '') AS response, r.responded_at
      FROM wp_campaign_contacts r LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId} AND r.responded_at IS NOT NULL
      ORDER BY r.responded_at DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      contactId: str(r.contact_uuid),
      name: String(r.name),
      phone: String(r.phone),
      response: String(r.response),
      at: new Date(r.responded_at as string),
    }));
  }

  /** What the campaign went to: the largest groups among its recipients, and how many had no contact at all. */
  async audienceMakeup(tx: Tx, orgId: number, campaignId: number) {
    const manual = await tx.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE phone_number IS NULL AND contact_id IS NULL)::int AS invalid,
             count(*) FILTER (WHERE status = 'unsubscribed' OR is_unsubscribed)::int AS opted_out
      FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId}`);
    const m = manual.rows[0] as { n: number; invalid: number; opted_out: number };
    const groups = await tx.execute(sql`
      SELECT g.name AS name, count(*)::int AS n
      FROM wp_campaign_contacts r
      JOIN contact_group_members gm ON gm.org_id = r.org_id AND gm.contact_id = r.contact_id
      JOIN contact_groups g ON g.org_id = gm.org_id AND g.id = gm.group_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId}
      GROUP BY g.id, g.name ORDER BY n DESC, g.id LIMIT 3`);
    const withContact = await tx.execute(sql`
      SELECT count(*)::int AS n FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND contact_id IS NOT NULL`);
    return {
      total: Number(m.n),
      invalid: Number(m.invalid),
      optedOut: Number(m.opted_out),
      withContact: Number((withContact.rows[0] as { n: number }).n),
      groups: (groups.rows as Array<{ name: string | null }>)
        .map((g) => g.name ?? '')
        .filter((n) => n !== ''),
    };
  }

  /** Top performers: the campaign's recipients grouped by contact group, ranked by read rate (TW-CAMP-019 "segments"). */
  async segments(tx: Tx, orgId: number, campaignId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT g.name AS name, count(DISTINCT r.id)::int AS recipients,
             count(DISTINCT r.id) FILTER (WHERE r.responded_at IS NOT NULL)::int AS replies,
             count(DISTINCT r.id) FILTER (WHERE r.read_at IS NOT NULL)::int AS reads,
             count(DISTINCT r.id) FILTER (WHERE r.is_unsubscribed OR r.status = 'unsubscribed')::int AS opt_outs
      FROM wp_campaign_contacts r
      JOIN contact_group_members gm ON gm.org_id = r.org_id AND gm.contact_id = r.contact_id
      JOIN contact_groups g ON g.org_id = gm.org_id AND g.id = gm.group_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId}
      GROUP BY g.id, g.name`);
    return (res.rows as Raw[])
      .map((r) => {
        const recipients = Number(r.recipients);
        return {
          name: String(r.name ?? ''),
          recipients,
          replies: Number(r.replies),
          optOuts: Number(r.opt_outs),
          readPct: recipients > 0 ? Math.round((Number(r.reads) / recipients) * 1000) / 10 : 0,
        };
      })
      .filter((s) => s.name !== '')
      .sort((a, b) => b.readPct - a.readPct)
      .slice(0, limit);
  }

  /** Real clicks per destination: the sum of the tracked links of this campaign, by the URL they point at. */
  async clicksByUrl(tx: Tx, orgId: number, campaignId: number): Promise<Map<string, number>> {
    const res = await tx.execute(sql`
      SELECT original_url, coalesce(sum(clicks), 0)::int AS total FROM wa_link_clicks
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} GROUP BY original_url`);
    return new Map((res.rows as Raw[]).map((r) => [String(r.original_url), Number(r.total)]));
  }

  /** WHO opted out: the campaign's recipients whose contact is now unsubscribed, newest first. */
  async optOuts(tx: Tx, orgId: number, campaignId: number, limit: number) {
    const res = await tx.execute(sql`
      SELECT coalesce(r.recipient_name, c.name, '') AS name, coalesce(r.phone_number, c.phone, '') AS phone,
             r.unsubscribed_at, r.sent_at
      FROM wp_campaign_contacts r LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId} AND (r.is_unsubscribed OR r.status = 'unsubscribed')
      ORDER BY coalesce(r.unsubscribed_at, r.sent_at) DESC NULLS LAST, r.id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      name: String(r.name),
      phone: String(r.phone),
      at:
        (r.unsubscribed_at ?? r.sent_at)
          ? new Date((r.unsubscribed_at ?? r.sent_at) as string)
          : null,
    }));
  }

  async optInCount(tx: Tx, orgId: number, campaignId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM wp_campaign_contacts r
      JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
      WHERE r.org_id = ${orgId} AND r.campaign_id = ${campaignId} AND NOT c.is_unsubscribed`);
    return Number((res.rows[0] as { n: number }).n);
  }

  async senderLabel(
    tx: Tx,
    orgId: number,
    provider: string | null,
    deviceId: number | null,
  ): Promise<{ key: string | null; label: string }> {
    if (deviceId === null) return { key: null, label: '' };
    if ((provider ?? 'baileys') === 'baileys') {
      const res = await tx.execute(sql`
        SELECT uuid, coalesce(nullif(device_name, ''), nullif(trim(coalesce(country_code, '') || ' ' || coalesce(phone_number, '')), '')) AS label
        FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`);
      const r = res.rows[0] as { uuid: string; label: string | null } | undefined;
      return r
        ? { key: `baileys:${r.uuid}`, label: r.label ?? `#${deviceId}` }
        : { key: null, label: `#${deviceId}` };
    }
    const res = await tx.execute(sql`
      SELECT uuid, provider, coalesce(nullif(display_label, ''), phone_number) AS label
      FROM wa_provider_configs WHERE org_id = ${orgId} AND id = ${deviceId}`);
    const r = res.rows[0] as { uuid: string; provider: string; label: string | null } | undefined;
    return r
      ? { key: `${r.provider}:${r.uuid}`, label: r.label ?? `#${deviceId}` }
      : { key: null, label: `#${deviceId}` };
  }

  async flowsForOrg(tx: Tx, orgId: number): Promise<Array<{ id: string; name: string }>> {
    const res = await tx.execute(
      sql`SELECT uuid, flow_name AS name FROM flows WHERE org_id = ${orgId} ORDER BY id DESC`,
    );
    return (res.rows as Array<{ uuid: string; name: string }>).map((r) => ({
      id: r.uuid,
      name: r.name,
    }));
  }

  async groupsWithCounts(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT g.uuid, g.name AS name, count(m.contact_id)::int AS members
      FROM contact_groups g LEFT JOIN contact_group_members m ON m.org_id = g.org_id AND m.group_id = g.id
      WHERE g.org_id = ${orgId} GROUP BY g.id, g.uuid, g.name ORDER BY g.id DESC`);
    return (res.rows as Array<{ uuid: string; name: string | null; members: number }>).map((r) => ({
      id: r.uuid,
      name: r.name ?? '',
      members: Number(r.members),
    }));
  }

  async tagsWithCounts(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT t.uuid, t.name, t.color,
             (SELECT count(DISTINCT x.id) FROM (
                SELECT ct.contact_id AS id FROM contact_tags ct WHERE ct.org_id = t.org_id AND ct.tag_id = t.id
                UNION
                SELECT c.contact_id FROM conversation_tag cvt
                  JOIN conversations c ON c.org_id = cvt.org_id AND c.id = cvt.conversation_id
                  WHERE cvt.org_id = t.org_id AND cvt.tag_id = t.id AND c.contact_id IS NOT NULL
             ) x)::int AS members
      FROM tags t WHERE t.org_id = ${orgId} ORDER BY t.name`);
    return (
      res.rows as Array<{ uuid: string; name: string; color: string | null; members: number }>
    ).map((r) => ({ id: r.uuid, name: r.name, color: r.color, members: Number(r.members) }));
  }

  /** The names and phones of these contacts, for the recipient and export rows. */
  async contactNames(tx: Tx, orgId: number, ids: readonly number[]) {
    const out = new Map<number, { name: string; phone: string }>();
    for (const part of chunks(ids)) {
      const res = await tx.execute(
        sql`SELECT id, coalesce(name, '') AS name, coalesce(phone, '') AS phone FROM contacts WHERE org_id = ${orgId} AND id IN (${list(part, 'bigint')})`,
      );
      for (const r of res.rows as Array<{ id: number | string; name: string; phone: string }>)
        out.set(Number(r.id), { name: r.name, phone: r.phone });
    }
    return out;
  }
}

const RECIPIENT_SELECT = sql`
  SELECT r.id, r.uuid, r.contact_id, c.uuid AS contact_uuid, r.variant, r.status, r.send_attempts, r.next_attempt_at,
         coalesce(nullif(r.phone_number, ''), c.phone) AS phone_number, coalesce(nullif(r.recipient_name, ''), c.name) AS recipient_name,
         r.whatsapp_message_id, r.clicked, r.click_count, r.clicked_at, r.sent_at, r.delivered_at, r.read_at, r.responded_at, r.response,
         r.error_message, r.created_at, r.updated_at
  FROM wp_campaign_contacts r LEFT JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id`;

function toRecipient(r: Raw): RecipientRow {
  return {
    id: Number(r.id),
    uuid: String(r.uuid),
    contactId: num(r.contact_id),
    contactUuid: str(r.contact_uuid),
    variant: str(r.variant),
    status: String(r.status),
    sendAttempts: Number(r.send_attempts ?? 0),
    nextAttemptAt: date(r.next_attempt_at),
    phone: str(r.phone_number),
    name: str(r.recipient_name),
    providerMessageId: str(r.whatsapp_message_id),
    clicked: Boolean(r.clicked),
    clickCount: Number(r.click_count ?? 0),
    clickedAt: date(r.clicked_at),
    sentAt: date(r.sent_at),
    deliveredAt: date(r.delivered_at),
    readAt: date(r.read_at),
    respondedAt: date(r.responded_at),
    response: str(r.response),
    error: str(r.error_message),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}
