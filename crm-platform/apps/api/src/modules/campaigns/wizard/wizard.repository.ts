import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { WizardFollowUpStepSummary } from '@crm/contracts';
import type { CampaignOptionColumns } from './wizard-blank';

/** The SQL of the broadcast wizard: templates, audience sources, the wizard columns of a campaign, series, retries and test sends. */

type Raw = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const when = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export interface TemplateListRow {
  id: number;
  uuid: string;
  name: string;
  language: string;
  header: string | null;
  body: string;
  footer: string | null;
  category: string | null;
  metaCategory: string | null;
  templateType: string;
  buttons: unknown;
  variableMap: unknown;
  parameterFormat: string | null;
  attachmentType: string | null;
  attachmentFile: string | null;
  metaTemplateId: string | null;
  metaStatus: string | null;
  pausedUntil: Date | null;
  qualityScore: string | null;
  channel: string | null;
  twilioContentSid: string | null;
  providerConfigId: number | null;
  configUuid: string | null;
  configProvider: string | null;
  senderLabel: string | null;
}

export interface WizardCampaignRow {
  id: number;
  uuid: string;
  name: string;
  status: string;
  wizard: { draft?: unknown; launch?: Record<string, unknown> } | null;
  seriesId: number | null;
  seriesUuid: string | null;
  occurrenceNo: number | null;
  runAt: Date | null;
  retryEnabled: boolean;
  retryUntil: Date | null;
  templateId: number | null;
  templateUuid: string | null;
  templateName: string | null;
  provider: string | null;
  deviceId: number | null;
  totalRecipients: number;
  lastRunAt: Date | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface SeriesRow {
  id: number;
  uuid: string;
  name: string;
  status: string;
  rule: unknown;
  blueprint: unknown;
  templateId: number | null;
  templateUuid: string | null;
  templateName: string | null;
  provider: string;
  deviceId: number | null;
  nextIndex: number;
  nextRunAt: Date | null;
  occurrencesCreated: number;
  occurrencesSkipped: number;
  lastOccurrenceAt: Date | null;
  endedAt: Date | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

export interface HistoryRow {
  uuid: string;
  name: string;
  status: string;
  isWizard: boolean;
  kind: 'now' | 'scheduled' | 'recurring';
  seriesUuid: string | null;
  occurrenceNo: number | null;
  templateName: string | null;
  senderLabel: string | null;
  runAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  sortIso: string;
  counts: {
    recipients: number;
    sent: number;
    delivered: number;
    read: number;
    replies: number;
    clicks: number;
    failed: number;
  };
}

/** `%` and `_` in a search typed by a person are letters, not wildcards. */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface RetryTotals {
  pending: number;
  nextRetryAt: Date | null;
  recovered: number;
  exhausted: number;
}

export interface TestSendRow {
  id: number;
  uuid: string;
  to: string;
  status: string;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** BL-191: when a test held for the quiet hours goes out; null otherwise. */
  heldUntil: Date | null;
  createdAt: Date;
}

const toTestSend = (r: Raw): TestSendRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  to: String(r.to_phone),
  status: String(r.status),
  providerMessageId: str(r.provider_message_id),
  errorCode: str(r.error_code),
  errorMessage: str(r.error_message),
  heldUntil: r.held_until ? new Date(r.held_until as string) : null,
  createdAt: new Date(r.created_at as string),
});

const toCampaign = (r: Raw): WizardCampaignRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.campaign_name),
  status: String(r.status),
  wizard: (r.wizard as WizardCampaignRow['wizard']) ?? null,
  seriesId: num(r.series_id),
  seriesUuid: str(r.series_uuid),
  occurrenceNo: num(r.occurrence_no),
  runAt: when(r.run_at),
  retryEnabled: Boolean(r.retry_enabled),
  retryUntil: when(r.retry_until),
  templateId: num(r.template_id),
  templateUuid: str(r.template_uuid),
  templateName: str(r.template_name),
  provider: str(r.provider),
  deviceId: num(r.device_id),
  totalRecipients: Number(r.total_recipients ?? 0),
  lastRunAt: when(r.last_run_at),
  createdBy: num(r.created_by),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const toSeries = (r: Raw): SeriesRow => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.name),
  status: String(r.status),
  rule: r.rule,
  blueprint: r.blueprint,
  templateId: num(r.template_id),
  templateUuid: str(r.template_uuid),
  templateName: str(r.template_name),
  provider: String(r.provider),
  deviceId: num(r.device_id),
  nextIndex: Number(r.next_index),
  nextRunAt: when(r.next_run_at),
  occurrencesCreated: Number(r.occurrences_created),
  occurrencesSkipped: Number(r.occurrences_skipped),
  lastOccurrenceAt: when(r.last_occurrence_at),
  endedAt: when(r.ended_at),
  createdBy: num(r.created_by),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

const CAMPAIGN_SELECT = sql`
  SELECT c.*, t.uuid AS template_uuid, t.template_name, s.uuid AS series_uuid
  FROM wpcampaigns c
  LEFT JOIN wa_templates t ON t.org_id = c.org_id AND t.id = c.template_id
  LEFT JOIN camp_series s ON s.org_id = c.org_id AND s.id = c.series_id`;

const SERIES_SELECT = sql`
  SELECT s.*, t.uuid AS template_uuid, t.template_name
  FROM camp_series s
  LEFT JOIN wa_templates t ON t.org_id = s.org_id AND t.id = s.template_id`;

@Injectable()
export class WizardRepository {
  // ------------------------------------------------------------------------------------------ templates

  /**
   * Templates the wizard may offer: approved the way the broadcast composer reads it (Meta's approval on the Cloud engine, the local
   * approval on any other), not an OTP template, and tied to a number that is still connected.
   */
  async approvedTemplates(tx: Tx, orgId: number): Promise<TemplateListRow[]> {
    const eng = await tx.execute(
      sql`SELECT default_engine FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
    );
    const def = (eng.rows[0] as { default_engine: string | null } | undefined)?.default_engine;
    const approved =
      def === 'waba'
        ? sql`t.meta_template_id IS NOT NULL AND t.meta_status = 'APPROVED' AND (t.paused_until IS NULL OR t.paused_until <= now())`
        : sql`t.status IN ('approved', 'public')`;
    const res = await tx.execute(sql`
      SELECT t.id, t.uuid, t.template_name, t.language, t.header, t.template_body, t.footer, t.category, t.meta_category,
             t.template_type, t.buttons, t.variable_map, t.parameter_format, t.attachment_type, t.attachment_file,
             t.meta_template_id, t.meta_status, t.paused_until, t.quality_score, t.channel, t.twilio_content_sid,
             t.provider_config_id, c.uuid AS config_uuid, c.provider AS config_provider,
             coalesce(nullif(c.display_label, ''), c.phone_number) AS sender_label
      FROM wa_templates t
      LEFT JOIN wa_provider_configs c ON c.org_id = t.org_id AND c.id = t.provider_config_id
      WHERE t.org_id = ${orgId} AND ${approved} AND t.template_type <> 'auth'
        AND (t.provider_config_id IS NULL OR c.status = 'connected')
      ORDER BY t.id DESC`);
    return (res.rows as Raw[]).map((r) => this.template(r));
  }

  /** One template by uuid with its sender, whether or not it is approved (the caller gates it). */
  async templateByUuid(tx: Tx, orgId: number, uuid: string): Promise<TemplateListRow | undefined> {
    const res = await tx.execute(sql`
      SELECT t.id, t.uuid, t.template_name, t.language, t.header, t.template_body, t.footer, t.category, t.meta_category,
             t.template_type, t.buttons, t.variable_map, t.parameter_format, t.attachment_type, t.attachment_file,
             t.meta_template_id, t.meta_status, t.paused_until, t.quality_score, t.channel, t.twilio_content_sid,
             t.provider_config_id, c.uuid AS config_uuid, c.provider AS config_provider,
             coalesce(nullif(c.display_label, ''), c.phone_number) AS sender_label
      FROM wa_templates t
      LEFT JOIN wa_provider_configs c ON c.org_id = t.org_id AND c.id = t.provider_config_id
      WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    return r ? this.template(r) : undefined;
  }

  private template(r: Raw): TemplateListRow {
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      name: String(r.template_name),
      language: String(r.language),
      header: str(r.header),
      body: String(r.template_body ?? ''),
      footer: str(r.footer),
      category: str(r.category),
      metaCategory: str(r.meta_category),
      templateType: String(r.template_type),
      buttons: r.buttons ?? [],
      variableMap: r.variable_map ?? {},
      parameterFormat: str(r.parameter_format),
      attachmentType: str(r.attachment_type),
      attachmentFile: str(r.attachment_file),
      metaTemplateId: str(r.meta_template_id),
      metaStatus: str(r.meta_status),
      pausedUntil: when(r.paused_until),
      qualityScore: str(r.quality_score),
      channel: str(r.channel),
      twilioContentSid: str(r.twilio_content_sid),
      providerConfigId: num(r.provider_config_id),
      configUuid: str(r.config_uuid),
      configProvider: str(r.config_provider),
      senderLabel: str(r.sender_label),
    };
  }

  // ------------------------------------------------------------------------------------------ audience sources

  async groups(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT g.uuid, g.name, g.color, count(m.contact_id)::int AS members
      FROM contact_groups g LEFT JOIN contact_group_members m ON m.org_id = g.org_id AND m.group_id = g.id
      WHERE g.org_id = ${orgId} GROUP BY g.id, g.uuid, g.name, g.color ORDER BY lower(g.name), g.id`);
    return (res.rows as Raw[]).map((r) => ({
      id: String(r.uuid),
      name: String(r.name ?? ''),
      color: str(r.color),
      memberCount: Number(r.members),
    }));
  }

  /** Shared segments, the caller's own and those shared with them (by name or through a team). The count is the last one the segment stored (a list never counts). */
  async segments(tx: Tx, orgId: number, userId: number | null) {
    const res = await tx.execute(sql`
      SELECT uuid, name, color, member_count_cache FROM segments
      WHERE org_id = ${orgId} AND (visibility = 'shared' OR owner_id = ${userId}::bigint
        OR (visibility = 'specific' AND EXISTS (
          SELECT 1 FROM segment_shares sh
          WHERE sh.org_id = segments.org_id AND sh.segment_id = segments.id
            AND (sh.user_id = ${userId}::bigint
                 OR sh.team_id IN (SELECT tm.team_id FROM team_members tm
                                   WHERE tm.org_id = segments.org_id AND tm.user_id = ${userId}::bigint)))))
      ORDER BY lower(name), id`);
    return (res.rows as Raw[]).map((r) => ({
      id: String(r.uuid),
      name: String(r.name),
      color: str(r.color),
      memberCount: num(r.member_count_cache),
    }));
  }

  /** How many of these groups and segments exist in the organization (a forged id is not one of them). */
  async existing(
    tx: Tx,
    orgId: number,
    groupIds: readonly string[],
    segmentIds: readonly string[],
  ): Promise<{ groups: Set<string>; segments: Set<string> }> {
    const uuids = (ids: readonly string[]) =>
      sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      );
    const g =
      groupIds.length === 0
        ? { rows: [] }
        : await tx.execute(
            sql`SELECT uuid FROM contact_groups WHERE org_id = ${orgId} AND uuid IN (${uuids(groupIds)})`,
          );
    const s =
      segmentIds.length === 0
        ? { rows: [] }
        : await tx.execute(
            sql`SELECT uuid FROM segments WHERE org_id = ${orgId} AND uuid IN (${uuids(segmentIds)})`,
          );
    return {
      groups: new Set((g.rows as Array<{ uuid: string }>).map((r) => r.uuid)),
      segments: new Set((s.rows as Array<{ uuid: string }>).map((r) => r.uuid)),
    };
  }

  // ------------------------------------------------------------------------------------------ the wizard columns of a campaign

  async campaignByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<WizardCampaignRow | undefined> {
    const res = await tx.execute(
      sql`${CAMPAIGN_SELECT} WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid AND c.wizard IS NOT NULL`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toCampaign(r) : undefined;
  }

  async campaignById(tx: Tx, orgId: number, id: number): Promise<WizardCampaignRow | undefined> {
    const res = await tx.execute(
      sql`${CAMPAIGN_SELECT} WHERE c.org_id = ${orgId} AND c.id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toCampaign(r) : undefined;
  }

  /** The draft row locked, so two saves or a save and a launch take turns. */
  async lockCampaign(tx: Tx, orgId: number, uuid: string): Promise<WizardCampaignRow | undefined> {
    await tx.execute(
      sql`SELECT 1 FROM wpcampaigns WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND wizard IS NOT NULL FOR UPDATE`,
    );
    return this.campaignByUuid(tx, orgId, uuid);
  }

  /** Writes what the wizard owns on a campaign row. `retryUntil` and the others are written as given (null clears). */
  async attach(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      wizard: unknown;
      seriesId?: number | null;
      occurrenceNo?: number | null;
      runAt?: Date | null;
      retryEnabled?: boolean;
      retryUntil?: Date | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wpcampaigns SET wizard = ${json(v.wizard)}::jsonb,
        series_id = ${v.seriesId ?? null}::bigint, occurrence_no = ${v.occurrenceNo ?? null}::int,
        run_at = ${v.runAt ? v.runAt.toISOString() : null}::timestamptz,
        retry_enabled = ${v.retryEnabled ?? false},
        retry_until = ${v.retryUntil ? v.retryUntil.toISOString() : null}::timestamptz
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Saves the draft JSON (and the name and template the list shows) without touching the series or retry columns. */
  async saveDraft(
    tx: Tx,
    orgId: number,
    id: number,
    v: { wizard: unknown; name: string; templateId: number | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wpcampaigns SET wizard = ${json(v.wizard)}::jsonb, campaign_name = ${v.name}, template_id = ${v.templateId}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setLaunch(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      wizard: unknown;
      provider: string;
      deviceId: number | null;
      scheduleType: string;
      sendDate: string | null;
      sendTime: string | null;
      timezone: string;
      status: string;
      total: number;
      runAt: Date | null;
      seriesId: number | null;
      occurrenceNo: number | null;
      retryEnabled: boolean;
      retryUntil: Date | null;
      options: CampaignOptionColumns;
    },
  ): Promise<void> {
    const o = v.options;
    await tx.execute(sql`
      UPDATE wpcampaigns SET wizard = ${json(v.wizard)}::jsonb, provider = ${v.provider}, device_id = ${v.deviceId},
        ab_testing = ${o.abTesting}, ab_split = ${o.abSplit}, template_id_b = ${o.templateIdB},
        tracking_enabled = ${o.trackingEnabled}, retry_failed = ${o.retryFailed}, expires_at = ${o.expiresAt ? o.expiresAt.toISOString() : null}::timestamptz,
        throttle_min_sec = ${o.throttleMinSec}, throttle_max_sec = ${o.throttleMaxSec}, batch_size = ${o.batchSize},
        batch_pause_min = ${o.batchPauseMin}, daily_limit = ${o.dailyLimit}, window_start = ${o.windowStart},
        window_end = ${o.windowEnd}, follow_up_count = ${o.followUpCount},
        series_id = ${v.seriesId}::bigint, occurrence_no = ${v.occurrenceNo}::int,
        schedule_type = ${v.scheduleType}, send_date = ${v.sendDate}::date, send_time = ${v.sendTime}::time,
        timezone = ${v.timezone}, status = ${v.status}, total_recipients = ${v.total},
        run_at = ${v.runAt ? v.runAt.toISOString() : null}::timestamptz,
        retry_enabled = ${v.retryEnabled}, retry_until = ${v.retryUntil ? v.retryUntil.toISOString() : null}::timestamptz,
        last_run_at = CASE WHEN ${v.status === 'running'} THEN now() ELSE last_run_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async deleteCampaignOnly(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wpcampaigns WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // ------------------------------------------------------------------------------------------ series

  async insertSeries(
    tx: Tx,
    orgId: number,
    v: {
      name: string;
      rule: unknown;
      blueprint: unknown;
      templateId: number | null;
      provider: string;
      deviceId: number | null;
      nextRunAt: Date | null;
      createdBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO camp_series (org_id, name, rule, blueprint, template_id, provider, device_id, next_run_at, created_by)
      VALUES (${orgId}, ${v.name}, ${json(v.rule)}::jsonb, ${json(v.blueprint)}::jsonb, ${v.templateId}, ${v.provider},
              ${v.deviceId}, ${v.nextRunAt ? v.nextRunAt.toISOString() : null}::timestamptz, ${v.createdBy})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async seriesByUuid(tx: Tx, orgId: number, uuid: string): Promise<SeriesRow | undefined> {
    const res = await tx.execute(
      sql`${SERIES_SELECT} WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toSeries(r) : undefined;
  }

  async seriesById(tx: Tx, orgId: number, id: number): Promise<SeriesRow | undefined> {
    const res = await tx.execute(sql`${SERIES_SELECT} WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toSeries(r) : undefined;
  }

  async lockSeries(tx: Tx, orgId: number, id: number): Promise<SeriesRow | undefined> {
    await tx.execute(
      sql`SELECT 1 FROM camp_series WHERE org_id = ${orgId} AND id = ${id} FOR UPDATE`,
    );
    return this.seriesById(tx, orgId, id);
  }

  /** Active series whose next occurrence is due, across tenants (the planner is privileged). */
  async dueSeries(tx: Tx, now: Date, limit: number): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, id FROM camp_series
      WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ${now.toISOString()}::timestamptz
      ORDER BY next_run_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
    return (res.rows as Array<{ org_id: number | string; id: number | string }>).map((r) => ({
      orgId: Number(r.org_id),
      id: Number(r.id),
    }));
  }

  async planSeries(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      nextIndex: number;
      nextRunAt: Date | null;
      created: number;
      skipped: number;
      lastOccurrenceAt: Date | null;
      status?: string;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE camp_series SET next_index = ${v.nextIndex},
        next_run_at = ${v.nextRunAt ? v.nextRunAt.toISOString() : null}::timestamptz,
        occurrences_created = occurrences_created + ${v.created}, occurrences_skipped = occurrences_skipped + ${v.skipped},
        last_occurrence_at = coalesce(${v.lastOccurrenceAt ? v.lastOccurrenceAt.toISOString() : null}::timestamptz, last_occurrence_at),
        status = coalesce(${v.status ?? null}, status),
        ended_at = CASE WHEN ${v.status === 'ended'} THEN now() ELSE ended_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setSeriesStatus(tx: Tx, orgId: number, id: number, status: string): Promise<void> {
    await tx.execute(sql`
      UPDATE camp_series SET status = ${status},
        ended_at = CASE WHEN ${status === 'cancelled' || status === 'ended'} THEN coalesce(ended_at, now()) ELSE ended_at END
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Takes the row locks of every run of the series. A worker moving a run from scheduled to running waits for the transaction that
   * holds them, and then finds the run gone, so a delete never removes a run a worker has just claimed.
   */
  async lockSeriesRuns(tx: Tx, orgId: number, seriesId: number): Promise<void> {
    await tx.execute(
      sql`SELECT id FROM wpcampaigns WHERE org_id = ${orgId} AND series_id = ${seriesId} ORDER BY id FOR UPDATE`,
    );
  }

  /** True once any run of the series has sent a message: its history is then kept. */
  async seriesHasSent(tx: Tx, orgId: number, seriesId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM wp_campaign_contacts r
      JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id
      WHERE c.org_id = ${orgId} AND c.series_id = ${seriesId}
        AND (r.status IN ('sent', 'delivered', 'read', 'responded') OR r.sent_at IS NOT NULL
             OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async deleteSeries(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM camp_series WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async seriesChildren(tx: Tx, orgId: number, seriesId: number): Promise<WizardCampaignRow[]> {
    const res = await tx.execute(
      sql`${CAMPAIGN_SELECT} WHERE c.org_id = ${orgId} AND c.series_id = ${seriesId} ORDER BY c.occurrence_no DESC`,
    );
    return (res.rows as Raw[]).map(toCampaign);
  }

  /** The unified page of wizard broadcasts: one-off campaigns and series, newest first. Cursor is `<created_at iso>|<uuid>`. */
  async listPage(
    tx: Tx,
    orgId: number,
    o: {
      limit: number;
      cursor: { at: string; uuid: string } | null;
      status: string | null;
      type?: 'now' | 'scheduled' | 'recurring' | null;
      q?: string | null;
    },
  ): Promise<Array<{ kind: 'campaign' | 'series'; uuid: string; createdAtIso: string }>> {
    const conditions = [
      ...(o.cursor
        ? [sql`(created_at, uuid) < (${o.cursor.at}::timestamptz, ${o.cursor.uuid}::uuid)`]
        : []),
      ...(o.status ? [sql`status = ${o.status}`] : []),
      ...(o.type ? [sql`mode = ${o.type}`] : []),
      ...(o.q ? [sql`name ILIKE ${`%${escapeLike(o.q)}%`}`] : []),
    ];
    const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const res = await tx.execute(sql`
      SELECT kind, uuid, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso FROM (
        SELECT 'campaign' AS kind, c.uuid, c.created_at, c.status, c.campaign_name AS name,
               CASE WHEN c.schedule_type = 'now' THEN 'now' ELSE 'scheduled' END AS mode
          FROM wpcampaigns c
          WHERE c.org_id = ${orgId} AND c.wizard IS NOT NULL AND c.series_id IS NULL
        UNION ALL
        SELECT 'series', s.uuid, s.created_at, s.status, s.name, 'recurring'
          FROM camp_series s WHERE s.org_id = ${orgId}
      ) x
      ${where}
      ORDER BY created_at DESC, uuid DESC LIMIT ${o.limit + 1}`);
    return (
      res.rows as Array<{ kind: 'campaign' | 'series'; uuid: string; created_at_iso: string }>
    ).map((r) => ({
      kind: r.kind,
      uuid: r.uuid,
      createdAtIso: r.created_at_iso,
    }));
  }

  /**
   * The history pages' rows: campaigns (a wizard broadcast, a run of a series, or a classic campaign that has started), with the
   * recipient counts, template and sender. `history` is newest first by start time; `scheduled` is the wizard's waiting one-offs,
   * soonest first. The cursor is `<sort time iso>|<uuid>` of the last row.
   */
  async historyPage(
    tx: Tx,
    orgId: number,
    o: {
      scope: 'history' | 'scheduled';
      limit: number;
      cursor: { at: string; uuid: string } | null;
      type: 'now' | 'scheduled' | 'recurring' | null;
      status: string | null;
      from: string | null;
      to: string | null;
      tz: string;
      q: string | null;
    },
  ): Promise<{ rows: HistoryRow[]; hasMore: boolean }> {
    const scheduled = o.scope === 'scheduled';
    const sortAt = scheduled ? sql`c.run_at` : sql`coalesce(c.last_run_at, c.created_at)`;
    const kind = sql`(CASE WHEN c.series_id IS NOT NULL THEN 'recurring' ELSE c.schedule_type END)`;
    const where = [
      sql`c.org_id = ${orgId}`,
      scheduled
        ? sql`c.wizard IS NOT NULL AND c.series_id IS NULL AND c.status = 'scheduled' AND c.run_at IS NOT NULL`
        : sql`c.status NOT IN ('draft', 'scheduled')`,
      ...(o.cursor
        ? [
            scheduled
              ? sql`(${sortAt}, c.uuid) > (${o.cursor.at}::timestamptz, ${o.cursor.uuid}::uuid)`
              : sql`(${sortAt}, c.uuid) < (${o.cursor.at}::timestamptz, ${o.cursor.uuid}::uuid)`,
          ]
        : []),
      ...(o.type ? [sql`${kind} = ${o.type}`] : []),
      ...(o.status ? [sql`c.status = ${o.status}`] : []),
      ...(o.from ? [sql`${sortAt} >= (${o.from}::date)::timestamp AT TIME ZONE ${o.tz}`] : []),
      ...(o.to ? [sql`${sortAt} < ((${o.to}::date + 1))::timestamp AT TIME ZONE ${o.tz}`] : []),
      ...(o.q ? [sql`c.campaign_name ILIKE ${`%${escapeLike(o.q)}%`}`] : []),
    ];
    const order = scheduled ? sql`${sortAt} ASC, c.uuid ASC` : sql`${sortAt} DESC, c.uuid DESC`;
    const res = await tx.execute(sql`
      SELECT p.*, t.template_name, s.uuid AS series_uuid,
             CASE WHEN coalesce(p.provider, 'baileys') = 'baileys'
                  THEN (SELECT coalesce(nullif(d.device_name, ''), nullif(trim(coalesce(d.country_code, '') || ' ' || coalesce(d.phone_number, '')), ''))
                        FROM devices d WHERE d.org_id = p.org_id AND d.id = p.device_id)
                  ELSE (SELECT coalesce(nullif(w.display_label, ''), w.phone_number)
                        FROM wa_provider_configs w WHERE w.org_id = p.org_id AND w.id = p.device_id)
             END AS sender_label,
             to_char(p.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_iso,
             agg.*
      FROM (
        SELECT c.org_id, c.id, c.uuid, c.campaign_name, c.status, c.wizard IS NOT NULL AS is_wizard, c.series_id, c.occurrence_no,
               ${kind} AS kind, c.run_at, c.last_run_at, c.completed_at, c.created_at, c.template_id, c.provider, c.device_id,
               ${sortAt} AS sort_at
        FROM wpcampaigns c
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY ${order} LIMIT ${o.limit + 1}
      ) p
      LEFT JOIN wa_templates t ON t.org_id = p.org_id AND t.id = p.template_id
      LEFT JOIN camp_series s ON s.org_id = p.org_id AND s.id = p.series_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS a_total,
          count(*) FILTER (WHERE r.status IN ('sent','delivered','read','responded') OR r.sent_at IS NOT NULL OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_sent,
          count(*) FILTER (WHERE r.status IN ('delivered','read','responded') OR r.delivered_at IS NOT NULL OR r.read_at IS NOT NULL OR r.responded_at IS NOT NULL)::int AS a_delivered,
          count(*) FILTER (WHERE r.status IN ('read','responded') OR r.read_at IS NOT NULL)::int AS a_read,
          count(*) FILTER (WHERE r.status = 'responded' OR r.responded_at IS NOT NULL)::int AS a_replies,
          count(*) FILTER (WHERE r.clicked OR r.clicked_at IS NOT NULL)::int AS a_clicks,
          count(*) FILTER (WHERE r.status = 'failed')::int AS a_failed
        FROM wp_campaign_contacts r WHERE r.org_id = p.org_id AND r.campaign_id = p.id
      ) agg ON true
      ORDER BY ${scheduled ? sql`p.sort_at ASC, p.uuid ASC` : sql`p.sort_at DESC, p.uuid DESC`}`);
    const all = (res.rows as Raw[]).map((r): HistoryRow => ({
      uuid: String(r.uuid),
      name: String(r.campaign_name),
      status: String(r.status),
      isWizard: Boolean(r.is_wizard),
      kind: String(r.kind) as HistoryRow['kind'],
      seriesUuid: str(r.series_uuid),
      occurrenceNo: num(r.occurrence_no),
      templateName: str(r.template_name),
      senderLabel: str(r.sender_label),
      runAt: when(r.run_at),
      startedAt: when(r.last_run_at),
      finishedAt: when(r.completed_at),
      createdAt: new Date(r.created_at as string),
      sortIso: String(r.sort_iso),
      counts: {
        recipients: Number(r.a_total ?? 0),
        sent: Number(r.a_sent ?? 0),
        delivered: Number(r.a_delivered ?? 0),
        read: Number(r.a_read ?? 0),
        replies: Number(r.a_replies ?? 0),
        clicks: Number(r.a_clicks ?? 0),
        failed: Number(r.a_failed ?? 0),
      },
    }));
    return { rows: all.slice(0, o.limit), hasMore: all.length > o.limit };
  }

  // ------------------------------------------------------------------------------------------ retries

  /** Open and finished retry counts of one campaign, for its summary. */
  async retryTotals(tx: Tx, orgId: number, campaignIds: readonly number[]): Promise<RetryTotals> {
    if (campaignIds.length === 0)
      return { pending: 0, nextRetryAt: null, recovered: 0, exhausted: 0 };
    const ids = sql.join(
      campaignIds.map((i) => sql`${i}::bigint`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE retry_state IN ('scheduled', 'sending', 'sent'))::int AS pending,
             min(retry_next_at) FILTER (WHERE retry_state = 'scheduled') AS next_at,
             count(*) FILTER (WHERE retry_state = 'recovered')::int AS recovered,
             count(*) FILTER (WHERE retry_state = 'exhausted')::int AS exhausted
      FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id IN (${ids})`);
    const r = res.rows[0] as Raw;
    return {
      pending: Number(r.pending),
      nextRetryAt: when(r.next_at),
      recovered: Number(r.recovered),
      exhausted: Number(r.exhausted),
    };
  }

  async flowExists(tx: Tx, orgId: number, uuid: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM flows WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    return res.rows.length > 0;
  }

  /** What each follow-up step did for a run: still ahead, sent, delivered, read, flows started, skipped, lapsed, failed. */
  async followUpTotals(
    tx: Tx,
    orgId: number,
    campaignId: number,
    steps: number,
  ): Promise<WizardFollowUpStepSummary[]> {
    if (steps <= 0) return [];
    const waiting = await tx.execute(sql`
      SELECT follow_up_next AS step, count(*)::int AS n FROM wp_campaign_contacts
      WHERE org_id = ${orgId} AND campaign_id = ${campaignId} AND follow_up_state = 'active' GROUP BY follow_up_next`);
    const done = await tx.execute(sql`
      SELECT step_no AS step,
        count(*) FILTER (WHERE outcome = 'sent')::int AS sent,
        count(*) FILTER (WHERE outcome = 'sent' AND delivery_status IN ('delivered', 'read'))::int AS delivered,
        count(*) FILTER (WHERE outcome = 'sent' AND delivery_status = 'read')::int AS read,
        count(*) FILTER (WHERE outcome = 'flow_started')::int AS flows,
        count(*) FILTER (WHERE outcome = 'skipped')::int AS skipped,
        count(*) FILTER (WHERE outcome = 'lapsed')::int AS lapsed,
        count(*) FILTER (WHERE outcome = 'failed' OR (outcome = 'sent' AND delivery_status = 'failed'))::int AS failed
      FROM camp_follow_up_attempts WHERE org_id = ${orgId} AND campaign_id = ${campaignId} GROUP BY step_no`);
    const w = new Map((waiting.rows as Raw[]).map((r) => [Number(r.step), Number(r.n)]));
    const d = new Map((done.rows as Raw[]).map((r) => [Number(r.step), r]));
    return Array.from({ length: steps }, (_, i) => {
      const step = i + 1;
      const r = d.get(step);
      return {
        step,
        waiting: w.get(step) ?? 0,
        sent: Number(r?.sent ?? 0),
        delivered: Number(r?.delivered ?? 0),
        read: Number(r?.read ?? 0),
        flowsStarted: Number(r?.flows ?? 0),
        skipped: Number(r?.skipped ?? 0),
        lapsed: Number(r?.lapsed ?? 0),
        failed: Number(r?.failed ?? 0),
      };
    });
  }

  async runCounts(tx: Tx, orgId: number, campaignId: number) {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS recipients,
        count(*) FILTER (WHERE status IN ('sent','delivered','read','responded') OR sent_at IS NOT NULL)::int AS sent,
        count(*) FILTER (WHERE status IN ('delivered','read','responded') OR delivered_at IS NOT NULL)::int AS delivered,
        count(*) FILTER (WHERE status IN ('read','responded') OR read_at IS NOT NULL)::int AS read,
        count(*) FILTER (WHERE status = 'responded' OR responded_at IS NOT NULL)::int AS replies,
        count(*) FILTER (WHERE clicked)::int AS clicks,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM wp_campaign_contacts WHERE org_id = ${orgId} AND campaign_id = ${campaignId}`);
    const r = res.rows[0] as Raw;
    return {
      recipients: Number(r.recipients),
      sent: Number(r.sent),
      delivered: Number(r.delivered),
      read: Number(r.read),
      replies: Number(r.replies),
      clicks: Number(r.clicks),
      failed: Number(r.failed),
    };
  }

  // ------------------------------------------------------------------------------------------ test sends

  async insertTestSend(
    tx: Tx,
    orgId: number,
    v: {
      campaignId: number;
      templateId: number | null;
      provider: string;
      to: string;
      status: string;
      providerMessageId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      renderedBody: string | null;
      createdBy: number | null;
      /** Held for the quiet hours (BL-191): the instant it may go and why. */
      held?: { until: string; reason: string };
    },
  ): Promise<{ id: number; uuid: string; createdAt: Date }> {
    const res = await tx.execute(sql`
      INSERT INTO camp_test_sends (org_id, campaign_id, template_id, provider, to_phone, status, provider_message_id, error_code,
                                   error_message, rendered_body, created_by, held_until, held_reason)
      VALUES (${orgId}, ${v.campaignId}, ${v.templateId}, ${v.provider}, ${v.to}, ${v.status}, ${v.providerMessageId}, ${v.errorCode},
              ${v.errorMessage ? v.errorMessage.slice(0, 1024) : null}, ${v.renderedBody}, ${v.createdBy},
              ${v.held?.until ?? null}::timestamptz, ${v.held?.reason ?? null})
      RETURNING id, uuid, created_at`);
    const r = res.rows[0] as Raw;
    return { id: Number(r.id), uuid: String(r.uuid), createdAt: new Date(r.created_at as string) };
  }

  async testSends(
    tx: Tx,
    orgId: number,
    campaignId: number,
    limit: number,
  ): Promise<TestSendRow[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, to_phone, status, provider_message_id, error_code, error_message, held_until, created_at
      FROM camp_test_sends WHERE org_id = ${orgId} AND campaign_id = ${campaignId}
      ORDER BY id DESC LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toTestSend);
  }

  async testSendsByIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<TestSendRow[]> {
    if (ids.length === 0) return [];
    const list = sql.join(
      ids.map((i) => sql`${i}::bigint`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT id, uuid, to_phone, status, provider_message_id, error_code, error_message, held_until, created_at
      FROM camp_test_sends WHERE org_id = ${orgId} AND id IN (${list}) ORDER BY id`);
    return (res.rows as Raw[]).map(toTestSend);
  }

  /** A test the quiet hours held back, with the draft it belongs to (BL-191). */
  async heldTestSend(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ status: string; to: string; campaignUuid: string } | undefined> {
    const res = await tx.execute(sql`
      SELECT t.status, t.to_phone, c.uuid AS campaign_uuid
      FROM camp_test_sends t JOIN wpcampaigns c ON c.org_id = t.org_id AND c.id = t.campaign_id
      WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r
      ? { status: String(r.status), to: String(r.to_phone), campaignUuid: String(r.campaign_uuid) }
      : undefined;
  }

  /** The recipient is still inside their own hours: the test waits for the next opening. */
  async holdTestSend(
    tx: Tx,
    orgId: number,
    id: number,
    hold: { until: string; reason: string },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE camp_test_sends SET held_until = ${hold.until}::timestamptz, held_reason = ${hold.reason}
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'held'`);
  }

  /** The held test went out (or was refused): the row takes the real status and is no longer held. */
  async finishHeldTestSend(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      status: 'sent' | 'failed';
      providerMessageId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE camp_test_sends SET status = ${v.status}, provider_message_id = ${v.providerMessageId}, error_code = ${v.errorCode},
             error_message = ${v.errorMessage ? v.errorMessage.slice(0, 1024) : null}, held_until = NULL, held_reason = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'held'`);
  }

  /** What the wallet charged for each of these provider messages (hundredths); absent when nothing was charged. */
  async chargesOf(tx: Tx, orgId: number, wamids: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (wamids.length === 0) return out;
    const list = sql.join(
      wamids.map((w) => sql`${w}`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT wamid, sum(revenue_minor)::bigint AS charged FROM usage_charges
      WHERE org_id = ${orgId} AND wamid IN (${list}) AND status = 'charged' GROUP BY wamid`);
    for (const r of res.rows as Array<{ wamid: string; charged: string | number }>) {
      out.set(r.wamid, Number(r.charged));
    }
    return out;
  }
}
