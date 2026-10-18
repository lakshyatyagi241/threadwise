import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BookingReminderChannel } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_MESSENGER,
  type AppointmentMessenger,
  type BookingMessage,
  type BookingMessageResult,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactActivitiesRepository } from '../crm';
import { APPOINTMENT_MODULE } from './appointment-rules';
import {
  REMINDER_MAX_ATTEMPTS,
  REMINDER_REASONS,
  gateRun,
  settleChannels,
  timelineEntry,
  type ChannelOutcome,
  type ReminderReason,
  type Settled,
} from './appointment-reminder.rules';
import { AppointmentRemindersRepository } from './appointment-reminders.repository';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { BookingTypesRepository } from './booking-types.repository';
import { reminderBody, variablesFor } from './message-render';

/** The audit module key of a reminder run. */
const RUN_MODULE = 'appointment_reminder_runs';

const SUBJECTS = {
  before: 'Reminder: your booking is coming up',
  after: 'Thank you for your visit',
} as const;

const isReason = (v: string | undefined): v is ReminderReason =>
  v !== undefined && (REMINDER_REASONS as readonly string[]).includes(v);

/** A messenger answer as an outcome of this channel. An unknown reason becomes a provider error, never a guess. */
export function outcomeOfResult(res: BookingMessageResult): ChannelOutcome {
  switch (res.status) {
    case 'sent':
      return { status: 'sent', providerMessageId: res.providerMessageId };
    case 'held':
      return {
        status: 'held',
        reason: isReason(res.reason) ? res.reason : 'channel_unavailable',
        until: res.holdUntil,
      };
    case 'failed':
      return { status: 'failed', reason: isReason(res.reason) ? res.reason : 'provider_error' };
    default:
      return { status: 'skipped', reason: isReason(res.reason) ? res.reason : 'no_channel' };
  }
}

/**
 * Delivers the reminder and follow-up runs the sweep claimed (BL-283). A run is "this rule for this booking"; delivery decides, in this
 * order and from the booking and the rule AS THEY ARE NOW:
 *
 *  1. does it still apply (the rule exists and is on, the booking was not moved, cancelled, declined or marked no-show, a reminder is
 *     not after the start, a follow-up is not a day late) - `gateRun`;
 *  2. each channel of the rule's ordered preference, through the messenger (quiet hours, the ConsentGate, the sender): the first that
 *     delivers wins, a channel that cannot (no number, no sender, WhatsApp outside its window with no template) falls to the next, and a
 *     hold (quiet hours, a channel that is down) stops the run and brings it back later with the preference intact;
 *  3. the outcome is written once: on the run, in the audit log, on the contact's timeline (sent, failed, skipped, a first hold) and as
 *     an outbox event, all in one transaction.
 *
 * A run is delivered at most once: a worker that dies mid-delivery leaves the run `sending`, and the sweep marks it `failed`
 * (`interrupted`) rather than send an SMS or an email twice.
 */
@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly runs: AppointmentRemindersRepository,
    private readonly appts: AppointmentsRepository,
    private readonly types: BookingTypesRepository,
    private readonly support: AppointmentsSupport,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly activities: ContactActivitiesRepository,
    @Inject(APPOINTMENT_MESSENGER) private readonly messenger: AppointmentMessenger,
  ) {}

  /** One pass: frees abandoned claims, takes what is waiting and due, works on each. Returns how many it took. */
  async processDue(limit: number): Promise<number> {
    const interrupted = await this.db.privileged((tx) => this.runs.recoverStale(tx));
    if (interrupted > 0) this.logger.warn({ interrupted }, 'reminder runs interrupted');
    const taken = await this.db.privileged((tx) => this.runs.takeWaiting(tx, limit));
    for (const { orgId, id } of taken) {
      try {
        await this.processOne(orgId, id);
      } catch (err) {
        this.logger.error({ err, orgId, id }, 'reminder run failed unexpectedly');
        await this.settleUnexpected(orgId, id).catch(() => undefined);
      }
    }
    return taken.length;
  }

  /** Works on a run this process has taken (status `sending`). */
  async processOne(orgId: number, id: number, now: Date = new Date()): Promise<void> {
    await RequestContextStore.run(
      {
        requestId: `appointment-reminder-${id}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.work(orgId, id, now),
    );
  }

  private async work(orgId: number, id: number, now: Date): Promise<void> {
    const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const run = await this.runs.findRun(tx, orgId, id);
      if (!run || run.status !== 'sending') return null;
      const row = await this.appts.findById(tx, orgId, run.appointmentId);
      const rule = await this.runs.findRule(tx, orgId, run.reminderId);
      const children =
        row?.bookingTypeId == null
          ? null
          : (await this.types.children(tx, orgId, [row.bookingTypeId])).get(row.bookingTypeId);
      const typeReminderBody =
        (children?.templates ?? []).find((t) => t.event === 'reminder' && t.plainBody?.trim())
          ?.plainBody ?? null;
      return { run, row, rule, typeReminderBody };
    });
    if (!loaded) return;
    const { run, row, rule, typeReminderBody } = loaded;

    if (!row) {
      await this.finish(orgId, run.id, null, run.kind, {
        status: 'cancelled',
        reason: 'booking_cancelled',
        channel: null,
      });
      return;
    }

    const gate = gateRun({
      runStatus: run.status,
      kind: run.kind,
      rule: rule ? { isActive: rule.isActive } : null,
      runArmedAtMs: run.armedAt.getTime(),
      bookingArmedAtMs: row.armedAt.getTime(),
      bookingStatus: row.status,
      startsAtMs: row.startsAt.getTime(),
      dueAtMs: run.dueAt.getTime(),
      nowMs: now.getTime(),
    });
    if (!gate.go) {
      await this.finish(orgId, run.id, row, run.kind, {
        status: gate.status,
        reason: gate.reason,
        channel: null,
      });
      return;
    }
    if (!rule || run.attempts > REMINDER_MAX_ATTEMPTS) {
      await this.finish(orgId, run.id, row, run.kind, {
        status: 'failed',
        reason: rule ? 'expired' : 'internal_error',
        channel: null,
      });
      return;
    }

    const facts = {
      typeName: row.bookingTypeName ?? row.title,
      title: row.title,
      inviteeName: row.inviteeName,
      startsAtMs: row.startsAt.getTime(),
      timezone: row.timezone,
      location: row.meetUrl ?? row.location,
      manageUrl: this.support.manageUrlOf(row),
      joinUrl: row.meetUrl,
    };
    const body = reminderBody(run.kind, rule.body, typeReminderBody, facts);
    const subject = rule.subject?.trim() || `${facts.typeName}: ${SUBJECTS[run.kind]}`;
    const vars = variablesFor(facts);

    const tried: Array<{ channel: BookingReminderChannel; outcome: ChannelOutcome }> = [];
    for (const channel of rule.channels) {
      const message: BookingMessage = {
        orgId,
        appointmentId: row.uuid,
        event: run.kind === 'before' ? 'reminder' : 'follow_up',
        channel,
        to: { name: row.inviteeName, phone: row.inviteePhone, email: row.inviteeEmail },
        body,
        subject,
        waTemplateId: rule.waTemplateUuid,
        variableMap: null,
        // Stable per (booking, arming, rule, channel): a retry is the same message, a reschedule is a new one.
        idempotencyKey: `apptrem:${row.uuid}:${run.armedAt.getTime()}:${run.kind}:${run.offsetMinutes}:${channel}`,
        contactId: row.contactUuid,
        variables: vars,
        purpose: run.kind === 'before' ? 'service' : 'follow_up',
        notAfter: run.kind === 'before' ? row.startsAt.toISOString() : null,
      };
      let outcome: ChannelOutcome;
      try {
        outcome = outcomeOfResult(await this.messenger.send(message));
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : 'unknown', orgId, id },
          'reminder channel failed unexpectedly',
        );
        outcome = { status: 'failed', reason: 'internal_error' };
      }
      tried.push({ channel, outcome });
      if (outcome.status !== 'skipped') break;
    }

    await this.finish(orgId, run.id, row, run.kind, settleChannels(tried, now), run.reason);
  }

  /** Writes the outcome of a run: the row, the audit trail, the timeline and an outbox event, in one transaction. */
  private async finish(
    orgId: number,
    runId: number,
    row: AppointmentRow | null,
    kind: 'before' | 'after',
    outcome:
      | Settled
      | { status: 'cancelled' | 'skipped'; reason: ReminderReason; channel: null },
    previousReason: string | null = null,
  ): Promise<void> {
    const held = outcome.status === 'held';
    // A hold that is still the same hold says nothing new: no second timeline entry, audit row or event.
    const again = held && previousReason === outcome.reason;
    const until = held ? (outcome as Settled).until : undefined;

    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.runs.finish(tx, orgId, runId, {
        status: outcome.status,
        reason: outcome.reason ?? null,
        channel: outcome.channel ?? null,
        ...(until ? { nextAttemptAt: until } : {}),
      });
      if (again) return;
      await this.audit.record(tx, {
        module: RUN_MODULE,
        recordId: runId,
        action: 'update',
        delta: {
          status: { old: 'pending', new: outcome.status },
          ...(outcome.reason ? { reason: { old: null, new: outcome.reason } } : {}),
          ...(outcome.channel ? { channel: { old: null, new: outcome.channel } } : {}),
        },
      });
      if (row) {
        await this.outbox.emit(tx, {
          orgId,
          aggregateModule: APPOINTMENT_MODULE,
          aggregateId: row.id,
          eventType: `appointment.reminder_${outcome.status}`,
          payload: {
            uuid: row.uuid,
            kind,
            reason: outcome.reason ?? null,
            channel: outcome.channel ?? null,
          },
        });
        // A cancelled run is the booking's own change (already on its timeline); it is not repeated per rule.
        if (row.contactId !== null && outcome.status !== 'cancelled') {
          const entry = timelineEntry(kind, outcome.status, outcome.channel, outcome.reason, until);
          await this.activities.insert(tx, orgId, {
            contactId: row.contactId,
            activityType: 'appointment_reminder',
            title: entry.title,
            body: entry.body,
            source: 'system',
            actorId: null,
          });
        }
      }
    });
  }

  /** Whatever we did not foresee: the run is closed as failed, never retried blindly (an SMS or an email may already have gone). */
  private async settleUnexpected(orgId: number, runId: number): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.runs.finish(tx, orgId, runId, {
        status: 'failed',
        reason: 'internal_error',
        channel: null,
      }),
    );
  }
}
