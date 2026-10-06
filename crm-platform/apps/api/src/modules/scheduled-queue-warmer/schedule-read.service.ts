import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  type ListSchedulesQuery,
  type ScheduleDetail,
  type ScheduleList,
  type ScheduleOptions,
  type ScheduleSummary,
} from '@crm/contracts';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

const RECIPIENT_PREVIEW = 200;

type Raw = Record<string, unknown>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number => Number(v ?? 0);

const TAB_FILTER: Record<ListSchedulesQuery['tab'], SQL | null> = {
  all: null,
  upcoming: sql`m.status = 'scheduled'`,
  running: sql`m.status = 'running'`,
  paused: sql`m.status = 'paused'`,
  completed: sql`m.status = 'completed'`,
  failed: sql`m.status IN ('failed', 'cancelled')`,
};

const SELECT = sql`
  m.uuid, m.schedule_name, m.status, m.schedule_type, m.recipient_type, m.template_type, m.provider, m.scheduled_time, m.next_run_at,
  m.last_run_at, m.timezone, m.repeat_interval, m.total_recipients, m.total_sent, m.total_delivered, m.total_failed, m.last_error,
  m.row_version, m.device_id, m.source`;

function summary(r: Raw, senderLabel: string | null): ScheduleSummary {
  return {
    id: String(r.uuid),
    name: String(r.schedule_name),
    status: String(r.status) as ScheduleSummary['status'],
    scheduleType: String(r.schedule_type) as ScheduleSummary['scheduleType'],
    recipientType: String(r.recipient_type) as ScheduleSummary['recipientType'],
    messageType: String(r.template_type),
    senderLabel,
    provider: (r.provider as string | null) ?? null,
    scheduledAt: iso(r.scheduled_time)!,
    nextRunAt: iso(r.next_run_at),
    lastRunAt: iso(r.last_run_at),
    timezone: String(r.timezone),
    repeatInterval: (r.repeat_interval as string | null) ?? null,
    totalRecipients: num(r.total_recipients),
    totalSent: num(r.total_sent),
    totalDelivered: num(r.total_delivered),
    totalFailed: num(r.total_failed),
    lastError: (r.last_error as string | null) ?? null,
    source: String(r.source ?? 'manual'),
    rowVersion: num(r.row_version),
  };
}

/** What the list, the detail page and the composer's pickers read (TW-SCHED-001, 002, 012). Everything is the caller's workspace. */
@Injectable()
export class ScheduleReadService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async list(q: ListSchedulesQuery): Promise<ScheduleList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const filter = TAB_FILTER[q.tab];
      const search = q.q
        ? sql`AND m.schedule_name ILIKE ${`%${q.q.replace(/[%_\\]/g, '\\$&')}%`}`
        : sql``;
      const where = sql`m.org_id = ${orgId} ${filter ? sql`AND ${filter}` : sql``} ${search}`;
      const rows = await tx.execute(sql`
        SELECT ${SELECT} FROM scheduled_messages m WHERE ${where}
         ORDER BY CASE WHEN m.status IN ('scheduled', 'running') THEN 0 ELSE 1 END, m.scheduled_time DESC, m.id DESC
         LIMIT ${q.limit} OFFSET ${q.offset}`);
      const total = await tx.execute(
        sql`SELECT count(*)::int AS n FROM scheduled_messages m WHERE ${where}`,
      );
      const stats = await tx.execute(sql`
        SELECT count(*)::int AS all,
               count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
               count(*) FILTER (WHERE status = 'running')::int AS running,
               count(*) FILTER (WHERE status = 'paused')::int AS paused,
               count(*) FILTER (WHERE status = 'completed')::int AS completed,
               count(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS failed
          FROM scheduled_messages WHERE org_id = ${orgId}`);
      const next = await tx.execute(sql`
        SELECT ${SELECT} FROM scheduled_messages m
         WHERE m.org_id = ${orgId} AND m.status = 'scheduled' AND coalesce(m.next_run_at, m.scheduled_time) >= now()
         ORDER BY coalesce(m.next_run_at, m.scheduled_time) LIMIT 1`);
      const labels = await this.labels(tx, orgId, [
        ...(rows.rows as Raw[]),
        ...(next.rows as Raw[]),
      ]);
      const s = stats.rows[0] as Raw;
      return {
        items: (rows.rows as Raw[]).map((r) =>
          summary(r, labels.get(`${r.provider}:${r.device_id}`) ?? null),
        ),
        total: num((total.rows[0] as Raw).n),
        stats: {
          all: num(s.all),
          upcoming: num(s.upcoming),
          running: num(s.running),
          paused: num(s.paused),
          completed: num(s.completed),
          failed: num(s.failed),
        },
        upNext: next.rows[0]
          ? summary(
              next.rows[0] as Raw,
              labels.get(`${(next.rows[0] as Raw).provider}:${(next.rows[0] as Raw).device_id}`) ??
                null,
            )
          : null,
      };
    });
  }

  async detail(uuid: string): Promise<ScheduleDetail> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${SELECT}, m.id, m.message_content, m.media_file, m.latitude, m.longitude, m.repeat_every, m.days_of_week,
               to_char(m.end_date, 'YYYY-MM-DD') AS end_date, to_char(m.send_date, 'YYYY-MM-DD') AS send_date, m.send_time,
               m.failure_reason, m.send_attempts
          FROM scheduled_messages m WHERE m.org_id = ${orgId} AND m.uuid = ${uuid}::uuid`);
      const r = res.rows[0] as Raw | undefined;
      if (!r) throw AppError.notFound('Schedule', uuid);
      const labels = await this.labels(tx, orgId, [r]);
      const counts = await tx.execute(sql`
        SELECT status, count(*)::int AS n FROM scheduled_message_contacts
         WHERE org_id = ${orgId} AND scheduled_message_id = ${Number(r.id)} GROUP BY status`);
      const people = await tx.execute(sql`
        SELECT c.phone, k.name AS contact_name, c.status, c.error_message, c.sent_at, c.delivered_at, c.read_at
          FROM scheduled_message_contacts c LEFT JOIN contacts k ON k.org_id = c.org_id AND k.id = c.contact_id
         WHERE c.org_id = ${orgId} AND c.scheduled_message_id = ${Number(r.id)}
         ORDER BY c.id LIMIT ${RECIPIENT_PREVIEW + 1}`);
      const rows = (people.rows as Raw[]).slice(0, RECIPIENT_PREVIEW);
      return {
        ...summary(r, labels.get(`${r.provider}:${r.device_id}`) ?? null),
        message: (r.message_content as string | null) ?? null,
        media: (r.media_file as string | null) ?? null,
        latitude: r.latitude === null ? null : Number(r.latitude),
        longitude: r.longitude === null ? null : Number(r.longitude),
        repeatEvery: num(r.repeat_every) || 1,
        daysOfWeek: Array.isArray(r.days_of_week) ? (r.days_of_week as number[]) : [],
        endDate: (r.end_date as string | null) ?? null,
        sendDate: String(r.send_date),
        sendTime: String(r.send_time),
        failureReason: (r.failure_reason as string | null) ?? null,
        sendAttempts: num(r.send_attempts),
        breakdown: Object.fromEntries(
          (counts.rows as Raw[]).map((c) => [String(c.status), num(c.n)]),
        ),
        recipients: rows.map((p) => ({
          phone: String(p.phone),
          contactName: (p.contact_name as string | null) ?? null,
          status: String(p.status) as ScheduleDetail['recipients'][number]['status'],
          error: (p.error_message as string | null) ?? null,
          sentAt: iso(p.sent_at),
          deliveredAt: iso(p.delivered_at),
          readAt: iso(p.read_at),
        })),
        recipientsTruncated: (people.rows as Raw[]).length > RECIPIENT_PREVIEW,
      };
    });
  }

  /** The composer's pickers: connected senders, groups, tags, earlier broadcasts and templates. */
  async options(minLeadMinutes: number): Promise<ScheduleOptions> {
    const { orgId } = RequestContextStore.require();
    // No personal-number senders are offered while the platform switch is off (owner decision 2026-10-05).
    const unofficialOn = await this.unofficial.isEnabled();
    return this.db.tx(async (tx) => {
      const devices = await tx.execute(sql`
        SELECT uuid, coalesce(nullif(device_name, ''), phone_number) AS label, country_code, phone_number, warmer_config
          FROM devices WHERE org_id = ${orgId} AND status = 'connected' AND active AND ${unofficialOn}::boolean ORDER BY id`);
      const configs = await tx.execute(sql`
        SELECT uuid, provider, coalesce(nullif(display_label, ''), provider) AS label, phone_number, warmer_config
          FROM wa_provider_configs WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') AND status = 'connected' ORDER BY id`);
      const warming = (c: unknown) => Boolean((c as { enabled?: boolean } | null)?.enabled);
      const groups = await tx.execute(sql`
        SELECT g.uuid, g.name, count(m.contact_id)::int AS members
          FROM contact_groups g LEFT JOIN contact_group_members m ON m.org_id = g.org_id AND m.group_id = g.id
         WHERE g.org_id = ${orgId} GROUP BY g.id, g.uuid, g.name ORDER BY g.name`);
      const tags = await tx.execute(sql`
        SELECT t.uuid, t.name, count(ct.contact_id)::int AS contacts
          FROM tags t LEFT JOIN contact_tags ct ON ct.org_id = t.org_id AND ct.tag_id = t.id
         WHERE t.org_id = ${orgId} GROUP BY t.id, t.uuid, t.name ORDER BY t.name`);
      const queues = await tx.execute(sql`
        SELECT b.uuid, b.name, count(DISTINCT bc.contact_id)::int AS recipients
          FROM broadcasts b LEFT JOIN broadcast_contacts bc ON bc.org_id = b.org_id AND bc.broadcast_id = b.id
         WHERE b.org_id = ${orgId} AND b.status IN ('completed', 'completed_with_errors')
         GROUP BY b.id, b.uuid, b.name ORDER BY b.id DESC LIMIT 100`);
      const templates = await tx.execute(sql`
        SELECT uuid, template_name AS name, language FROM wa_templates
         WHERE org_id = ${orgId} ORDER BY template_name LIMIT 200`);
      return {
        senders: [
          ...(devices.rows as Raw[]).map((d) => ({
            key: `baileys:${d.uuid}`,
            engine: 'baileys',
            label: String(d.label ?? ''),
            phone: [d.country_code, d.phone_number].filter(Boolean).join('') || null,
            warming: warming(d.warmer_config),
          })),
          ...(configs.rows as Raw[]).map((c) => ({
            key: `${c.provider}:${c.uuid}`,
            engine: String(c.provider),
            label: String(c.label ?? ''),
            phone: (c.phone_number as string | null) ?? null,
            warming: warming(c.warmer_config),
          })),
        ],
        groups: (groups.rows as Raw[]).map((g) => ({
          id: String(g.uuid),
          name: String(g.name ?? ''),
          members: num(g.members),
        })),
        tags: (tags.rows as Raw[]).map((t) => ({
          id: String(t.uuid),
          name: String(t.name ?? ''),
          contacts: num(t.contacts),
        })),
        queues: (queues.rows as Raw[]).map((b) => ({
          id: String(b.uuid),
          name: String(b.name ?? ''),
          recipients: num(b.recipients),
        })),
        templates: (templates.rows as Raw[]).map((t) => ({
          id: String(t.uuid),
          name: String(t.name),
          language: String(t.language ?? ''),
        })),
        minLeadMinutes,
      };
    });
  }

  /** `<engine>:<id>` to the sender's name, for the rows being shown. */
  private async labels(
    tx: import('@crm/db').Tx,
    orgId: number,
    rows: Raw[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const device = [
      ...new Set(
        rows
          .filter((r) => (r.provider ?? 'baileys') === 'baileys' && r.device_id !== null)
          .map((r) => Number(r.device_id)),
      ),
    ];
    const config = [
      ...new Set(
        rows
          .filter((r) => r.provider && r.provider !== 'baileys' && r.device_id !== null)
          .map((r) => Number(r.device_id)),
      ),
    ];
    if (device.length > 0) {
      const res = await tx.execute(sql`
        SELECT id, coalesce(nullif(device_name, ''), phone_number) AS label FROM devices
         WHERE org_id = ${orgId} AND id IN (${sql.join(
           device.map((d) => sql`${d}::bigint`),
           sql`, `,
         )})`);
      for (const d of res.rows as Raw[]) out.set(`baileys:${d.id}`, String(d.label ?? ''));
      for (const r of rows)
        if (!r.provider)
          out.set(`${r.provider}:${r.device_id}`, out.get(`baileys:${r.device_id}`) ?? '');
    }
    if (config.length > 0) {
      const res = await tx.execute(sql`
        SELECT id, provider, coalesce(nullif(display_label, ''), phone_number, provider) AS label FROM wa_provider_configs
         WHERE org_id = ${orgId} AND id IN (${sql.join(
           config.map((d) => sql`${d}::bigint`),
           sql`, `,
         )})`);
      for (const c of res.rows as Raw[]) out.set(`${c.provider}:${c.id}`, String(c.label ?? ''));
    }
    return out;
  }
}
