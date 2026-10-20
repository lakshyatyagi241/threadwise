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
  WALLET_GATE,
  isKnownTimeZone,
  wallTimeToUtc,
  type SenderDirectory,
  type WalletGate,
} from '../broadcasts';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { OutboundRegistry, SenderResolver, type SenderRef } from '../node-bridge-runtime';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import {
  ScheduleAudienceService,
  cleanNumber,
  type Recipient,
} from './audience/schedule-audience.service';
import { ScheduleContentService, type ResolvedContent } from './schedule-content.service';
import { ScheduleMessageBuilder } from './schedule-message-builder.service';
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

export const fail = (message: string, path: string): AppError =>
  AppError.validation(message, [{ path, message }]);

/**
 * The first send as an instant, or why it cannot be: a known timezone, a time of day, at least 2 minutes from `now` (when `checkLead`),
 * and an end date that is not before the first send. Create and edit check the same things.
 */
export function resolveWhen(
  input: { sendDate: string; sendTime: string; timezone: string; endDate?: string | null },
  now: Date,
  checkLead = true,
): { time: string; at: Date } {
  if (!isKnownTimeZone(input.timezone)) throw fail('Choose a valid timezone.', 'timezone');
  const time = normaliseTime(input.sendTime);
  const at = wallTimeToUtc(input.sendDate, time, input.timezone);
  if (checkLead && at.getTime() < now.getTime() + 2 * 60_000) {
    throw fail('Schedule must be at least 2 minutes from now.', 'sendTime');
  }
  if (input.endDate && input.endDate < input.sendDate) {
    throw fail('The end date cannot be before the first send.', 'endDate');
  }
  return { time, at };
}

/**
 * Turns the composer into schedules (TW-SCHED-003, 005, 006, 007, 008, 009, 019). The order of the checks is Reference's: plan, limit,
 * time, audience, the send gate (halt, content guardrails, wallet), sender, the warmer's budget, then the rows. Everything that can
 * refuse happens before anything is written, and the rows, their recipients and the warmer reservation commit together.
 *
 * Differences from Reference, all on purpose: a plain-text schedule must have a message; an opted-out contact is never messaged; the
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
    private readonly content: ScheduleContentService,
    private readonly builder: ScheduleMessageBuilder,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    @Inject(OUTBOUND_SEND_GUARD) private readonly guard: OutboundSendGuard,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async create(input: CreateScheduleInput): Promise<CreateScheduleResult> {
    const { orgId, userId } = RequestContextStore.require();
    await this.plans.assertFeature(orgId, 'scheduled_messages');
    await this.usage.assertCanAdd(orgId, 'scheduled_messages');

    // --- when ---
    const { time, at } = resolveWhen(input, this.now());

    // --- who ---
    // A sender that names the unofficial engine is refused with its own code while the platform switch is off (owner decision 2026-10-05).
    if (input.senders.some((k) => k.trim().startsWith(`${UNOFFICIAL_ENGINE}:`))) {
      await this.unofficial.assertEnabledFor(orgId);
    }
    const { sendersResolved, audience } = await this.db.tx(async (tx) => ({
      sendersResolved: await this.senders.resolve(tx, orgId, input.senders),
      audience: await this.audience.resolve(tx, orgId, input),
    }));
    if (sendersResolved.length === 0) throw fail('No valid senders in this workspace.', 'senders');
    if (audience.recipients.length === 0)
      throw fail('Selected recipients are empty.', 'recipientType');

    // --- what: checked against the numbers it goes through (a Cloud API number takes only an approved template) ---
    const kind = await this.content.resolve(orgId, input, sendersResolved);

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
      // The check above is the early, cheap refusal; this one is under the lock, in the inserting transaction (QA Sheet3 #15, D-05).
      await this.usage.assertCanAddIn(tx, orgId, 'scheduled_messages');
      if (input.scheduleType === 'once') {
        const reasons = await this.warmer.hold(
          tx,
          plan.map((p) => ({ sender: p.sender, recipients: p.recipients.length })),
          { isNow: false, sendDate: input.sendDate },
        );
        if (reasons.length > 0) throw fail(reasons.join(' '), 'schedule');
      }
      // Only a number that is warming counts a send against its daily budget, so only it has anything to give back later.
      const warming = new Set<string>();
      for (const p of plan) {
        if (await this.warmer.isWarming(tx, p.sender))
          warming.add(`${p.sender.engine}:${p.sender.id}`);
      }
      const out: Array<{ uuid: string; sender: SenderRef | null }> = [];
      for (const p of plan) {
        const reserves =
          input.scheduleType === 'once' && warming.has(`${p.sender.engine}:${p.sender.id}`);
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
             ${kind.templateRowId}, ${kind.templateType}, ${kind.overrides ? JSON.stringify(kind.overrides) : null}::jsonb,
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
             ${reserves ? p.recipients.length : 0}, ${reserves ? input.sendDate : null}::date)
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
    kind: ResolvedContent,
    to: string,
  ): Promise<void> {
    if (!sender) throw new Error('The sender is not connected.');
    const transport = this.outbound.get(sender.engine);
    if (!transport) throw new Error(`No sender is set up for ${sender.engine}.`);
    const open = await transport.open(orgId, sender);
    // The same builder a run uses, so the test is the message the customer gets (a template is filled the way a run fills it).
    const prepared = await this.db.tx((tx) =>
      this.builder.prepare(
        tx,
        orgId,
        {
          template_type: kind.templateType,
          message_content: kind.body,
          media_file: kind.media,
          latitude: kind.latitude,
          longitude: kind.longitude,
          template_id: kind.templateRowId,
          template_overrides: kind.overrides,
        },
        sender.engine,
      ),
    );
    await open.send(this.builder.command(prepared, to, undefined), {
      clientReference: `sched-test-${Date.now()}`,
      screen: { source: 'scheduled' },
    });
  }
}
