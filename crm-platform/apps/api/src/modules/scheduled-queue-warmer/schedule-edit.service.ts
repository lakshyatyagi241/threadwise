import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  createScheduleInputSchema,
  type CreateScheduleInput,
  type ScheduleDraft,
  type UpdateScheduleInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
} from '../../infra/providers/whatsapp/send-guard.port';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { SENDER_DIRECTORY, WALLET_GATE, type SenderDirectory, type WalletGate } from '../broadcasts';
import { SenderResolver } from '../node-bridge-runtime';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ScheduleAudienceService, type Recipient } from './audience/schedule-audience.service';
import { ScheduleContentService } from './schedule-content.service';
import { fail, resolveWhen } from './schedule-create.service';
import { ScheduleMediaService } from './schedule-media.service';
import { emitScheduledUpdated } from './scheduled-events';
import { WarmerService } from './warmer/warmer.service';

const PIVOT_CHUNK = 500;
const MODULE_KEY = 'scheduled_messages';

type Raw = Record<string, unknown>;

/** What the edit needs to know about a stored schedule: the row, the keys the composer uses for it, and whether it has started. */
interface Stored {
  id: number;
  uuid: string;
  status: string;
  rowVersion: number;
  provider: string | null;
  deviceId: number | null;
  senderKey: string | null;
  senderLabel: string | null;
  scheduleType: 'once' | 'recurring';
  started: boolean;
  warmerReserved: number;
  warmerReservedDay: string | null;
  totalSent: number;
  mediaKey: string | null;
  draft: ScheduleDraft;
}

const messageTypeOf = (templateType: string): ScheduleDraft['messageType'] =>
  templateType === 'template'
    ? 'template'
    : templateType === 'location'
      ? 'location'
      : templateType === 'media' || templateType === 'media_with_caption'
        ? 'media'
        : 'plain';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/**
 * Editing a schedule that has not started (TW-SCHED-016). Reference had a PATCH nobody called and no screen; here the edit screen is
 * the composer opened on the stored schedule, and the server checks exactly what create checks: the plan, the time (2 minutes ahead
 * when it changed), the audience, the message against the number it goes through, the send gate and the wallet, and the warmer's
 * budget, which is given back for the old day and number and taken again for the new ones. A stale `rowVersion` is a 409.
 *
 * Allowed while the schedule is waiting or paused and nobody has been messaged yet (a recurring schedule may be edited between its
 * occurrences; a one-off that has begun cannot, because a changed message or audience would not reach the people already sent to).
 * The change is audited and announced with `scheduled.updated` in the same transaction.
 */
@Injectable()
export class ScheduleEditService {
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly audience: ScheduleAudienceService,
    private readonly warmer: WarmerService,
    private readonly content: ScheduleContentService,
    private readonly media: ScheduleMediaService,
    private readonly senderResolver: SenderResolver,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  /** The composer's draft for the schedule, for the edit screen. 409 when it can no longer be edited. */
  async draft(uuid: string): Promise<ScheduleDraft> {
    const { orgId } = RequestContextStore.require();
    const stored = await this.db.tx((tx) => this.load(tx, orgId, uuid));
    this.assertEditable(stored);
    return stored.draft;
  }

  async edit(uuid: string, patch: UpdateScheduleInput): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.plans.assertFeature(orgId, 'scheduled_messages');
    const stored = await this.db.tx((tx) => this.load(tx, orgId, uuid));
    this.assertEditable(stored);
    if (stored.rowVersion !== patch.rowVersion) throw AppError.rowVersionConflict('Schedule');

    // --- the schedule as it would be after the change, checked as a new one is ---
    const eff = this.merge(stored.draft, patch);
    const parsed = createScheduleInputSchema.safeParse(eff);
    if (!parsed.success) {
      throw AppError.validation(
        'Check the highlighted fields.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const input = parsed.data;
    const timeChanged =
      patch.sendDate !== undefined ||
      patch.sendTime !== undefined ||
      patch.timezone !== undefined ||
      patch.scheduleType !== undefined;
    const { time, at } = resolveWhen(input, this.now(), timeChanged);

    const senderKey = patch.sender ?? stored.senderKey;
    if (!senderKey) throw fail('Choose the number to send from.', 'sender');
    const senderChanged = patch.sender !== undefined && patch.sender !== stored.senderKey;
    if (senderKey.trim().startsWith(`${UNOFFICIAL_ENGINE}:`)) {
      await this.unofficial.assertEnabledFor(orgId);
    }
    const audienceChanged = patch.recipientType !== undefined;
    const { sender, audience } = await this.db.tx(async (tx) => ({
      sender: (await this.senders.resolve(tx, orgId, [senderKey]))[0],
      audience: audienceChanged ? await this.audience.resolve(tx, orgId, input) : null,
    }));
    if (!sender) throw fail('That number is not connected in this workspace.', 'sender');
    if (audience && audience.recipients.length === 0)
      throw fail('Selected recipients are empty.', 'recipientType');

    const kind = await this.content.resolve(orgId, input, [sender]);
    const count = audience ? audience.recipients.length : stored.draft.totalRecipients;
    await this.guard.beforeSend({ body: kind.body, bulk: true, source: 'scheduled' });
    await this.wallet.precheck(orgId, count, {
      source: 'scheduled',
      ...(audience ? { phones: audience.recipients.map((r) => r.phone) } : {}),
    });

    // --- write: the row, its recipients, the warmer budget, the trail and the event, all or nothing ---
    const ref = await this.db.tx((tx) =>
      this.senderResolver.resolve(tx, orgId, { provider: sender.engine, deviceId: sender.id }),
    );
    await this.db.tx(async (tx) => {
      const lock = await tx.execute(sql`
        SELECT status, row_version FROM scheduled_messages
         WHERE org_id = ${orgId} AND id = ${stored.id} FOR UPDATE`);
      const cur = lock.rows[0] as { status: string; row_version: number } | undefined;
      if (!cur || !['scheduled', 'paused'].includes(cur.status)) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'The schedule started while you were editing it.',
          409,
        );
      }
      if (Number(cur.row_version) !== patch.rowVersion) throw AppError.rowVersionConflict('Schedule');

      // The budget the old plan reserved goes back, and the new plan asks for its own: a warming number holds the whole change if it
      // cannot take it, and the release rolls back with it.
      let reserved = 0;
      let reservedDay: string | null = null;
      const unused = Math.max(0, stored.warmerReserved - stored.totalSent);
      if (unused > 0 && stored.warmerReservedDay && stored.provider && stored.deviceId !== null) {
        await this.warmer.release(
          tx,
          { engine: stored.provider, id: stored.deviceId },
          stored.warmerReservedDay,
          unused,
        );
      }
      if (input.scheduleType === 'once') {
        const reasons = await this.warmer.hold(tx, [{ sender, recipients: count }], {
          isNow: false,
          sendDate: input.sendDate,
        });
        if (reasons.length > 0) throw fail(reasons.join(' '), 'schedule');
        if (await this.warmer.isWarming(tx, sender)) {
          reserved = count;
          reservedDay = input.sendDate;
        }
      }

      const targets = this.targets(input, audience?.recipients ?? null);
      const done = await tx.execute(sql`
        UPDATE scheduled_messages SET
          schedule_name = ${input.name}, message_content = ${kind.body}, template_id = ${kind.templateRowId},
          template_type = ${kind.templateType},
          template_overrides = ${kind.overrides ? JSON.stringify(kind.overrides) : null}::jsonb,
          schedule_type = ${input.scheduleType}, send_date = ${input.sendDate}::date, send_time = ${time}, timezone = ${input.timezone},
          scheduled_time = coalesce(${timeChanged ? at.toISOString() : null}::timestamptz, scheduled_time),
          repeat_interval = ${input.scheduleType === 'recurring' ? (input.repeatInterval ?? null) : null},
          repeat_every = ${input.repeatEvery ?? 1},
          days_of_week = ${input.daysOfWeek?.length ? JSON.stringify([...new Set(input.daysOfWeek)].sort()) : null}::jsonb,
          end_date = ${input.endDate ?? null}::date,
          media_file = ${kind.media}, latitude = ${kind.latitude}, longitude = ${kind.longitude},
          device_id = ${sender.id}, provider = ${sender.engine}, from_number = ${ref?.phoneDigits ?? null},
          warmer_reserved = ${reserved}, warmer_reserved_day = ${reservedDay}::date,
          ${audience ? sql`recipient_type = ${input.recipientType}, target_groups = ${targets.groups}::jsonb, target_queues = ${targets.queues}::jsonb,
            target_numbers = ${targets.numbers}::jsonb, total_recipients = ${count}, recipients_spent = false,` : sql``}
          next_run_at = coalesce(${timeChanged ? at.toISOString() : null}::timestamptz, next_run_at)
        WHERE org_id = ${orgId} AND id = ${stored.id} AND row_version = ${patch.rowVersion}
        RETURNING id`);
      if (done.rows.length === 0) throw AppError.rowVersionConflict('Schedule');
      if (audience) {
        await tx.execute(sql`
          DELETE FROM scheduled_message_contacts WHERE org_id = ${orgId} AND scheduled_message_id = ${stored.id}`);
        await this.seed(tx, orgId, stored.id, audience.recipients);
      }

      const delta = this.delta(stored.draft, input, count, sender.key);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: stored.id,
        action: 'update',
        ...(Object.keys(delta).length ? { delta } : {}),
      });
      await emitScheduledUpdated(this.outbox, tx, orgId, stored.id, Object.keys(delta));
    });

    // The previous upload goes when nothing uses it any more (after the change is saved, never before it).
    if (stored.mediaKey && stored.mediaKey !== kind.media) {
      await this.media.releaseIfUnused(orgId, stored.mediaKey);
    }
  }

  // --- internals ---------------------------------------------------------------------------------

  private assertEditable(s: Stored): void {
    if (!['scheduled', 'paused'].includes(s.status)) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Only a waiting or paused schedule can be edited.',
        409,
      );
    }
    if (s.started && s.scheduleType === 'once') {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'This schedule has already started sending, so it can no longer be edited. Cancel it and create a new one.',
        409,
      );
    }
  }

  /** The stored schedule with the composer's name for every field; the patch is laid over `draft`. */
  private merge(d: ScheduleDraft, p: UpdateScheduleInput): CreateScheduleInput {
    const content = p.messageType !== undefined;
    const aud = p.recipientType !== undefined;
    const messageType = p.messageType ?? d.messageType;
    const scheduleType = p.scheduleType ?? d.scheduleType;
    const eff: Record<string, unknown> = {
      name: p.name ?? d.name,
      scheduleType,
      sendDate: p.sendDate ?? d.sendDate,
      sendTime: p.sendTime ?? d.sendTime,
      timezone: p.timezone ?? d.timezone,
      senders: [p.sender ?? d.sender ?? ''],
      messageType,
      recipientType: p.recipientType ?? d.recipientType,
    };
    if (scheduleType === 'recurring') {
      eff.repeatInterval = p.repeatInterval === undefined ? (d.repeatInterval ?? undefined) : (p.repeatInterval ?? undefined);
      eff.repeatEvery = p.repeatEvery ?? d.repeatEvery;
      const days = p.daysOfWeek ?? d.daysOfWeek;
      if (days.length) eff.daysOfWeek = days;
    }
    const end = p.endDate === undefined ? d.endDate : p.endDate;
    if (end) eff.endDate = end;
    const from = <K extends keyof ScheduleDraft & keyof UpdateScheduleInput>(k: K) =>
      content ? p[k] : (p[k] ?? d[k]);
    const message = from('message');
    if (message !== undefined && message !== null) eff.message = message;
    if (messageType === 'template') {
      const t = from('templateId');
      if (t) eff.templateId = t;
      const o = from('templateOverrides');
      if (o) eff.templateOverrides = o;
    }
    if (messageType === 'media') {
      // An upload wins over a link; picking one clears the other.
      if (p.mediaId) eff.mediaId = p.mediaId;
      else if (p.media) eff.media = p.media;
      else if (!content) {
        if (d.mediaFile) eff.mediaId = d.mediaFile.id;
        else if (d.media) eff.media = d.media;
      }
    }
    if (messageType === 'location') {
      const lat = from('latitude');
      const lng = from('longitude');
      if (lat !== undefined && lat !== null) eff.latitude = lat;
      if (lng !== undefined && lng !== null) eff.longitude = lng;
    }
    const pick = <K extends 'groupIds' | 'tagIds' | 'queueIds' | 'numbers'>(k: K) =>
      aud ? p[k] : (p[k] ?? d[k]);
    if (eff.recipientType === 'group') eff.groupIds = pick('groupIds');
    if (eff.recipientType === 'tag') eff.tagIds = pick('tagIds');
    if (eff.recipientType === 'queue') eff.queueIds = pick('queueIds');
    if (eff.recipientType === 'number') eff.numbers = pick('numbers');
    return eff as unknown as CreateScheduleInput;
  }

  /** The audience columns for the row, as create writes them (tags carry a `tag:` prefix; typed numbers are the resolved phones). */
  private targets(input: CreateScheduleInput, recipients: readonly Recipient[] | null) {
    const json = (v: unknown) => (v === null ? null : JSON.stringify(v));
    return {
      groups: json(
        input.recipientType === 'group'
          ? (input.groupIds ?? [])
          : input.recipientType === 'tag'
            ? (input.tagIds ?? []).map((t) => `tag:${t}`)
            : null,
      ),
      queues: json(input.recipientType === 'queue' ? (input.queueIds ?? []) : null),
      numbers: json(
        input.recipientType === 'number' ? (recipients ?? []).map((r) => r.phone) : null,
      ),
    };
  }

  private delta(
    before: ScheduleDraft,
    after: CreateScheduleInput,
    count: number,
    senderKey: string,
  ): Record<string, { old: unknown; new: unknown }> {
    const out: Record<string, { old: unknown; new: unknown }> = {};
    const note = (k: string, o: unknown, n: unknown) => {
      if (JSON.stringify(o) !== JSON.stringify(n)) out[k] = { old: o, new: n };
    };
    note('name', before.name, after.name);
    note('scheduleType', before.scheduleType, after.scheduleType);
    note('sendDate', before.sendDate, after.sendDate);
    note('sendTime', before.sendTime, after.sendTime);
    note('timezone', before.timezone, after.timezone);
    note('sender', before.sender, senderKey);
    note('messageType', before.messageType, after.messageType);
    note('message', before.message, after.message ?? '');
    note('templateId', before.templateId, after.templateId ?? null);
    note('totalRecipients', before.totalRecipients, count);
    return out;
  }

  /** One `pending` row per person, in chunks. */
  private async seed(
    tx: Tx,
    orgId: number,
    scheduledId: number,
    recipients: readonly Recipient[],
  ): Promise<void> {
    for (let i = 0; i < recipients.length; i += PIVOT_CHUNK) {
      const part = recipients.slice(i, i + PIVOT_CHUNK);
      await tx.execute(sql`
        INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, contact_id, phone)
        VALUES ${sql.join(
          part.map((r) => sql`(${orgId}, ${scheduledId}, ${r.contactId}, ${r.phone})`),
          sql`, `,
        )}
        ON CONFLICT DO NOTHING`);
    }
  }

  private async load(tx: Tx, orgId: number, uuid: string): Promise<Stored> {
    const res = await tx.execute(sql`
      SELECT m.id, m.uuid, m.status, m.row_version, m.schedule_name, m.schedule_type, to_char(m.send_date, 'YYYY-MM-DD') AS send_date,
             m.send_time, m.timezone, m.repeat_interval, m.repeat_every, m.days_of_week, to_char(m.end_date, 'YYYY-MM-DD') AS end_date,
             m.template_type, m.message_content, m.template_overrides, m.media_file, m.latitude, m.longitude, m.recipient_type,
             m.target_groups, m.target_queues, m.target_numbers, m.total_recipients, m.total_sent, m.provider, m.device_id,
             m.warmer_reserved, to_char(m.warmer_reserved_day, 'YYYY-MM-DD') AS warmer_reserved_day,
             t.uuid AS template_uuid,
             CASE WHEN m.provider IS NULL OR m.provider = 'baileys' THEN d.uuid ELSE c.uuid END AS sender_uuid,
             CASE WHEN m.provider IS NULL OR m.provider = 'baileys' THEN coalesce(nullif(d.device_name, ''), d.phone_number)
                  ELSE coalesce(nullif(c.display_label, ''), c.phone_number) END AS sender_label,
             EXISTS (SELECT 1 FROM scheduled_message_contacts x
                      WHERE x.org_id = m.org_id AND x.scheduled_message_id = m.id AND x.status <> 'pending') AS started
        FROM scheduled_messages m
        LEFT JOIN wa_templates t ON t.org_id = m.org_id AND t.id = m.template_id
        LEFT JOIN devices d ON d.org_id = m.org_id AND d.id = m.device_id
        LEFT JOIN wa_provider_configs c ON c.org_id = m.org_id AND c.id = m.device_id
       WHERE m.org_id = ${orgId} AND m.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) throw AppError.notFound('Schedule', uuid);
    const provider = (r.provider as string | null) ?? null;
    const senderKey = r.sender_uuid ? `${provider ?? 'baileys'}:${String(r.sender_uuid)}` : null;
    const type = messageTypeOf(String(r.template_type));
    const mediaKey = (r.media_file as string | null) ?? null;
    const file = await this.media.describe(tx, orgId, mediaKey);
    const tagged = strings(r.target_groups);
    const recipientType = String(r.recipient_type) as ScheduleDraft['recipientType'];
    const draft: ScheduleDraft = {
      id: String(r.uuid),
      rowVersion: Number(r.row_version),
      name: String(r.schedule_name),
      scheduleType: String(r.schedule_type) as ScheduleDraft['scheduleType'],
      sendDate: String(r.send_date),
      sendTime: String(r.send_time),
      timezone: String(r.timezone),
      repeatInterval: (r.repeat_interval as ScheduleDraft['repeatInterval']) ?? null,
      repeatEvery: Number(r.repeat_every) || 1,
      daysOfWeek: Array.isArray(r.days_of_week) ? (r.days_of_week as number[]) : [],
      endDate: (r.end_date as string | null) ?? null,
      sender: senderKey,
      messageType: type,
      // A template schedule keeps the template's own text in the column; the person's words are only the plain message and the caption.
      message: type === 'template' ? '' : ((r.message_content as string | null) ?? ''),
      templateId: (r.template_uuid as string | null) ?? null,
      templateOverrides: (r.template_overrides as Record<string, unknown> | null) ?? null,
      media: mediaKey && /^https?:\/\//i.test(mediaKey) ? mediaKey : null,
      mediaFile: file ? { ...file, url: await this.media.link(mediaKey!) } : null,
      latitude: r.latitude === null ? null : Number(r.latitude),
      longitude: r.longitude === null ? null : Number(r.longitude),
      recipientType,
      groupIds: recipientType === 'group' ? tagged.filter((g) => !g.startsWith('tag:')) : [],
      tagIds:
        recipientType === 'tag'
          ? tagged.filter((g) => g.startsWith('tag:')).map((g) => g.slice(4))
          : [],
      queueIds: recipientType === 'queue' ? strings(r.target_queues) : [],
      numbers: recipientType === 'number' ? strings(r.target_numbers) : [],
      totalRecipients: Number(r.total_recipients),
    };
    return {
      id: Number(r.id),
      uuid: String(r.uuid),
      status: String(r.status),
      rowVersion: Number(r.row_version),
      provider,
      deviceId: r.device_id === null ? null : Number(r.device_id),
      senderKey,
      senderLabel: (r.sender_label as string | null) ?? null,
      scheduleType: draft.scheduleType,
      started: Boolean(r.started),
      warmerReserved: Number(r.warmer_reserved),
      warmerReservedDay: (r.warmer_reserved_day as string | null) ?? null,
      totalSent: Number(r.total_sent),
      mediaKey,
      draft,
    };
  }
}
