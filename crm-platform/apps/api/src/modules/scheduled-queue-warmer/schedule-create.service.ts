import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CreateScheduleInput, CreateScheduleResult } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OUTBOUND_SEND_GUARD,
  type OutboundSendGuard,
} from '../../infra/providers/whatsapp/send-guard.port';
import {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  isKnownTimeZone,
  wallTimeToUtc,
  type SenderDirectory,
  type TemplateDirectory,
  type WalletGate,
} from '../broadcasts';
import { OutboundRegistry, SenderResolver, type SenderRef } from '../node-bridge-runtime';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import {
  ScheduleAudienceService,
  cleanNumber,
  type Recipient,
} from './audience/schedule-audience.service';
import { commandFor, type ScheduledRow } from './scheduled-message';
import { WarmerService } from './warmer/warmer.service';

const PIVOT_CHUNK = 500;

/** `H:mm` or `h:mm AM` as `HH:mm`. */
export function normaliseTime(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec(raw.trim());
  if (!m)
    throw AppError.validation('Enter the time as 14:30 or 2:30 PM.', [
      { path: 'sendTime', message: 'Invalid time' },
    ]);
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59)
    throw AppError.validation('Enter a valid time.', [
      { path: 'sendTime', message: 'Invalid time' },
    ]);
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Splits the audience between senders, one person to one sender (round robin): nobody gets two copies. */
export function splitRoundRobin<T>(items: readonly T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: parts }, () => []);
  items.forEach((x, i) => out[i % parts]!.push(x));
  return out;
}

const fail = (message: string, path: string): AppError =>
  AppError.validation(message, [{ path, message }]);

/**
 * Turns the composer into schedules (WD-SCHED-003, 005, 006, 007, 008, 009, 019). The order of the checks is WaDesk's: plan, limit,
 * time, audience, the send gate (halt, content guardrails, wallet), sender, the warmer's budget, then the rows. Everything that can
 * refuse happens before anything is written, and the rows, their recipients and the warmer reservation commit together.
 *
 * Differences from WaDesk, all on purpose: a plain-text schedule must have a message; an opted-out contact is never messaged; the
 * warmer reservation is released when the schedule is cancelled, deleted or fails; and typed numbers are not turned into contacts.
 */
@Injectable()
export class ScheduleCreateService {
  private readonly logger = new Logger(ScheduleCreateService.name);
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanEntitlementService,
    private readonly usage: PlanUsageService,
    private readonly audience: ScheduleAudienceService,
    private readonly warmer: WarmerService,
    private readonly senderResolver: SenderResolver,
    private readonly outbound: OutboundRegistry,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
  ) {}

  async create(input: CreateScheduleInput): Promise<CreateScheduleResult> {
    const { orgId, userId } = RequestContextStore.require();
    await this.plans.assertFeature(orgId, 'scheduled_messages');
    await this.usage.assertCanAdd(orgId, 'scheduled_messages');

    // --- when ---
    if (!isKnownTimeZone(input.timezone)) throw fail('Choose a valid timezone.', 'timezone');
    const time = normaliseTime(input.sendTime);
    const at = wallTimeToUtc(input.sendDate, time, input.timezone);
    if (at.getTime() < this.now().getTime() + 2 * 60_000) {
      throw fail('Schedule must be at least 2 minutes from now.', 'sendTime');
    }
    if (input.endDate && input.endDate < input.sendDate) {
      throw fail('The end date cannot be before the first send.', 'endDate');
    }

    // --- what ---
    const kind = await this.content(orgId, input);

    // --- who ---
    const { sendersResolved, audience } = await this.db.tx(async (tx) => ({
      sendersResolved: await this.senders.resolve(tx, orgId, input.senders),
      audience: await this.audience.resolve(tx, orgId, input),
    }));
    if (sendersResolved.length === 0) throw fail('No valid senders in this workspace.', 'senders');
    if (audience.recipients.length === 0)
      throw fail('Selected recipients are empty.', 'recipientType');
    if (kind.templateEngineBlocked && sendersResolved.some((s) => s.engine === 'waba')) {
      throw fail(
        'Template schedules are not available on WhatsApp Cloud API numbers yet. Use a plain message, or another sender.',
        'templateId',
      );
    }

    // --- the send gate: emergency halt and content guardrails, then the wallet (once, for everyone) ---
    await this.guard.beforeSend({ body: kind.body, bulk: true, source: 'scheduled' });
    await this.wallet.precheck(orgId, audience.recipients.length, {
      source: 'scheduled',
      phones: audience.recipients.map((r) => r.phone),
    });

    // --- fan out and write ---
    const slices = splitRoundRobin<Recipient>(audience.recipients, sendersResolved.length);
    const plan = sendersResolved
      .map((sender, i) => ({ sender, recipients: slices[i]! }))
      .filter((p) => p.recipients.length > 0);
    const ids: string[] = [];
    const created = await this.db.tx(async (tx) => {
      if (input.scheduleType === 'once') {
        const reasons = await this.warmer.hold(
          tx,
          plan.map((p) => ({ sender: p.sender, recipients: p.recipients.length })),
          { isNow: false, sendDate: input.sendDate },
        );
        if (reasons.length > 0) throw fail(reasons.join(' '), 'schedule');
      }
      const out: Array<{ uuid: string; sender: SenderRef | null }> = [];
      for (const p of plan) {
        const ref = await this.senderRef(tx, orgId, p.sender.engine, p.sender.id);
        const row = await tx.execute(sql`
          INSERT INTO scheduled_messages
            (org_id, user_id, device_id, schedule_name, message_content, template_id, template_type, template_overrides,
             schedule_type, send_date, send_time, scheduled_time, timezone, repeat_interval, repeat_every, days_of_week, end_date,
             media_file, latitude, longitude, recipient_type, target_groups, target_queues, target_numbers, total_recipients,
             from_number, status, next_run_at, provider, warmer_reserved, warmer_reserved_day)
          VALUES
            (${orgId}, ${userId}, ${p.sender.id},
             ${plan.length > 1 ? `${input.name} (${p.sender.label})` : input.name}, ${kind.body},
             ${kind.templateRowId}, ${kind.templateType}, ${input.templateOverrides ? JSON.stringify(input.templateOverrides) : null}::jsonb,
             ${input.scheduleType}, ${input.sendDate}::date, ${time}, ${at.toISOString()}::timestamptz, ${input.timezone},
             ${input.scheduleType === 'recurring' ? (input.repeatInterval ?? null) : null}, ${input.repeatEvery ?? 1},
             ${input.daysOfWeek?.length ? JSON.stringify([...new Set(input.daysOfWeek)].sort()) : null}::jsonb,
             ${input.endDate ?? null}::date,
             ${kind.media}, ${kind.latitude}, ${kind.longitude},
             ${plan.length > 1 ? 'number' : input.recipientType},
             ${plan.length === 1 && input.recipientType === 'group' ? JSON.stringify(input.groupIds ?? []) : plan.length === 1 && input.recipientType === 'tag' ? JSON.stringify((input.tagIds ?? []).map((t) => `tag:${t}`)) : null}::jsonb,
             ${plan.length === 1 && input.recipientType === 'queue' ? JSON.stringify(input.queueIds ?? []) : null}::jsonb,
             ${plan.length > 1 || input.recipientType === 'number' ? JSON.stringify(p.recipients.map((r) => r.phone)) : null}::jsonb,
             ${p.recipients.length}, ${ref?.phoneDigits ?? null}, 'scheduled', ${at.toISOString()}::timestamptz, ${p.sender.engine},
             ${input.scheduleType === 'once' ? p.recipients.length : 0}, ${input.scheduleType === 'once' ? input.sendDate : null}::date)
          RETURNING id, uuid`);
        const r = row.rows[0] as { id: number | string; uuid: string };
        await this.seed(tx, orgId, Number(r.id), p.recipients);
        out.push({ uuid: r.uuid, sender: ref });
        ids.push(r.uuid);
      }
      return out;
    });

    // --- the optional test message, after the schedule exists: a failure here never undoes it ---
    let testSent: boolean | null = null;
    let testError: string | null = null;
    if (input.testNumber) {
      const to = cleanNumber(input.testNumber);
      if (!to) {
        testSent = false;
        testError = 'The test number is not a valid phone number.';
      } else {
        try {
          await this.sendTest(orgId, created[0]!.sender, kind, to);
          testSent = true;
        } catch (err) {
          testSent = false;
          testError = err instanceof Error ? err.message : String(err);
          this.logger.warn({ orgId, err: testError }, '[SCHED] the test message was not sent');
        }
      }
    }

    const base =
      plan.length > 1
        ? `${plan.length} schedules created across ${plan.length} senders.`
        : 'Schedule created.';
    return {
      ids,
      sendersCount: plan.length,
      totalRecipients: audience.recipients.length,
      message:
        base +
        (testSent === true
          ? ' Test message sent to your number.'
          : testSent === false
            ? ` Test message wasn't sent - ${testError}`
            : ''),
      testSent,
      testError,
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  private async content(orgId: number, input: CreateScheduleInput) {
    const message = (input.message ?? '').trim();
    let body = message;
    let templateRowId: number | null = null;
    let templateEngineBlocked = false;
    if (input.messageType === 'template') {
      if (!input.templateId) throw fail('Choose a template.', 'templateId');
      const tpl = await this.db.tx((tx) => this.templates.find(tx, orgId, input.templateId!));
      if (!tpl) throw fail('That template was not found.', 'templateId');
      // The unofficial engine and Twilio send the template as its text; the Cloud API needs the template pipeline.
      body = tpl.templateBody;
      templateRowId = tpl.id;
      templateEngineBlocked = true;
    }
    const hasLocation = input.latitude !== undefined && input.longitude !== undefined;
    let media: string | null = null;
    if (input.media) {
      const m = input.media;
      // A link the sender can fetch. Uploaded files (a stored key) wait for the send port to accept file bytes.
      if (!/^https?:\/\//i.test(m)) throw fail('Give the file as a link (https://...).', 'media');
      media = m;
    }
    const templateType = hasLocation
      ? 'location'
      : media
        ? body
          ? 'media_with_caption'
          : 'media'
        : 'text';
    // WaDesk let an empty plain message through and then failed every recipient; refuse it here.
    if (templateType === 'text' && !body) throw fail('Write the message to send.', 'message');
    if (input.messageType === 'media' && !media) throw fail('Upload the file to send.', 'media');
    if (input.messageType === 'location' && !hasLocation)
      throw fail('Pick the place to send.', 'latitude');
    return {
      body,
      templateRowId,
      templateEngineBlocked,
      templateType,
      media,
      latitude: hasLocation ? input.latitude! : null,
      longitude: hasLocation ? input.longitude! : null,
    };
  }

  private async senderRef(
    tx: Tx,
    orgId: number,
    engine: string,
    id: number,
  ): Promise<SenderRef | null> {
    return this.senderResolver.resolve(tx, orgId, { provider: engine, deviceId: id });
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

  private async sendTest(
    orgId: number,
    sender: SenderRef | null,
    kind: {
      body: string;
      templateType: string;
      media: string | null;
      latitude: number | null;
      longitude: number | null;
    },
    to: string,
  ): Promise<void> {
    if (!sender) throw new Error('The sender is not connected.');
    const transport = this.outbound.get(sender.engine);
    if (!transport) throw new Error(`No sender is set up for ${sender.engine}.`);
    const open = await transport.open(orgId, sender);
    const row = {
      template_type: kind.templateType,
      message_content: kind.body,
      media_file: kind.media,
      latitude: kind.latitude,
      longitude: kind.longitude,
    } as unknown as ScheduledRow;
    await open.send(commandFor(row, to, kind.body), {
      clientReference: `sched-test-${Date.now()}`,
      screen: { source: 'scheduled' },
    });
  }
}
