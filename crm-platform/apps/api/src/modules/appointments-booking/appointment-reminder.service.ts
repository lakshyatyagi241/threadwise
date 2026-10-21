import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  REMINDER_REBOOK_FEATURE,
  defaultStepKind,
  type BookingReminderChannel,
  type BookingReminderKind,
  type BookingReminderStepKind,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_MESSENGER,
  type AppointmentMessenger,
  type BookingMessage,
  type BookingMessageEvent,
  type BookingMessageResult,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ContactActivitiesRepository } from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { APPOINTMENT_MODULE } from './appointment-rules';
import {
  REMINDER_MAX_ATTEMPTS,
  REMINDER_REASONS,
  attemptLogOf,
  gateRun,
  settleChannels,
  timelineEntry,
  type AttemptEntry,
  type ChannelOutcome,
  type ReminderReason,
  type Settled,
} from './appointment-reminder.rules';
import { namedBodyOf } from './appointment-template.rules';
import {
  AppointmentRemindersRepository,
  type RuleRow,
  type RunRow,
} from './appointment-reminders.repository';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { BookingTypesRepository } from './booking-types.repository';
import { renderTemplate, stepBody, variablesFor, type MessageFacts } from './message-render';
import { ReminderReplyService } from './reminder-reply.service';

/** The audit module key of a reminder run. */
const RUN_MODULE = 'appointment_reminder_runs';

/** The email subject of each step when it has none of its own (the type's name goes in front). */
const SUBJECTS: Record<BookingReminderStepKind, string> = {
  confirmation: 'Your booking is confirmed',
  reminder_24h: 'Reminder: your booking is coming up',
  reminder_2h: 'Reminder: your booking is coming up',
  reminder_15m: 'Reminder: your booking starts soon',
  reminder: 'Reminder: your booking is coming up',
  after_visit: 'Thank you for your visit',
  no_show: 'We missed you',
  rebook: 'Time to book again',
};

/** The first look at a WhatsApp message after it was handed over, then the sweep keeps watching (see `watchDelivery`). */
const FIRST_DELIVERY_CHECK_MS = 2 * 60_000;
const NEXT_DELIVERY_CHECK_MS = 5 * 60_000;
/** A message nobody reported on after this long is no longer watched. */
const WATCH_LIMIT_MS = 6 * 3_600_000;

const isReason = (v: string | undefined): v is ReminderReason =>
  v !== undefined && (REMINDER_REASONS as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The booking message event a step is sent as. */
export function eventOf(step: BookingReminderStepKind): BookingMessageEvent {
  switch (step) {
    case 'confirmation':
      return 'confirmation';
    case 'after_visit':
      return 'follow_up';
    case 'no_show':
      return 'no_show';
    case 'rebook':
      return 'rebook';
    default:
      return 'reminder';
  }
}

/** Marketing consent applies to the after-visit and rebook steps (WhatsApp files them under MARKETING); the others are service messages. */
const purposeOf = (step: BookingReminderStepKind): 'service' | 'follow_up' =>
  step === 'after_visit' || step === 'rebook' ? 'follow_up' : 'service';

interface Loaded {
  run: RunRow;
  row: AppointmentRow | null;
  rule: RuleRow | undefined;
  typeReminderBody: string | null;
  laterBooking: boolean;
}

/**
 * Delivers the steps of a booking's reminder sequence that the sweep claimed (BL-283, BL-421). A run is "this step for this booking";
 * delivery decides, in this order and from the booking and the step AS THEY ARE NOW:
 *
 *  1. does it still apply (the step exists and is on, the booking was not moved, cancelled, declined or marked no-show, a reminder is
 *     not at or after the start, the customer has not already confirmed when the step skips itself, a follow-up is not a day late) -
 *     `gateRun`;
 *  2. each channel of the step's ordered preference, through the messenger (quiet hours, the ConsentGate, the sender): the first that
 *     delivers wins. A channel that cannot (no number, no consent, no sender, WhatsApp outside its window with no approved template, the
 *     provider refused it) falls to the next; a hold (quiet hours, a channel that is down) stops the run and brings it back later with
 *     the preference intact. Every channel tried is written to the run's log with the reason, so the booking can say WHY email was used;
 *  3. the outcome is written once: on the run, in the audit log, on the contact's timeline (sent, failed, skipped, a first hold) and as
 *     an outbox event, all in one transaction.
 *
 * After a WhatsApp message is handed over, `watchDelivery` looks at what the provider reports: a message that failed afterwards, or (when
 * the step asks for it) was not delivered within N minutes, goes out on the next channel.
 *
 * A run is delivered at most once: a worker that dies mid-delivery leaves the run `sending`, and the sweep marks it `failed`
 * (`interrupted`) rather than send an email twice.
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
    private readonly replies: ReminderReplyService,
    private readonly entitlements: PlanEntitlementService,
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

  /**
   * The event steps: the booking was confirmed (the confirmation) or marked no-show (the no-show message). Takes a run for the step if
   * the booking's type has it switched on and delivers it at once. A booking is claimed once per arming, so the same event delivered
   * twice (the outbox is at-least-once) sends once. Runs in the worker, under the event's tenant.
   */
  async deliverEventStep(
    orgId: number,
    appointmentId: number,
    step: 'confirmation' | 'no_show',
  ): Promise<void> {
    const runId = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.runs.claimEvent(tx, orgId, appointmentId, step),
    );
    if (runId === null) return;
    try {
      await this.processOne(orgId, runId);
    } catch (err) {
      this.logger.error({ err, orgId, runId }, 'event step failed unexpectedly');
      await this.settleUnexpected(orgId, runId).catch(() => undefined);
    }
  }

  /** The run and everything delivery decides from. `status` is the state the run must be in (a delivery check wants a sent one). */
  private async load(
    orgId: number,
    id: number,
    status: 'sending' | 'sent' = 'sending',
  ): Promise<Loaded | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const run = await this.runs.findRun(tx, orgId, id);
      if (!run || run.status !== status) return null;
      const row = await this.appts.findById(tx, orgId, run.appointmentId);
      const rule = await this.runs.findRule(tx, orgId, run.reminderId);
      const children =
        row?.bookingTypeId == null
          ? null
          : (await this.types.children(tx, orgId, [row.bookingTypeId])).get(row.bookingTypeId);
      // The type's own reminder text: a library message it chose (read now), else the text it typed.
      const typeReminderBody =
        (children?.templates ?? [])
          .filter((t) => t.event === 'reminder')
          .map((t) => (t.libraryActive && t.libraryBody?.trim() ? t.libraryBody : t.plainBody))
          .find((b) => b?.trim()) ?? null;
      const stepOfRun =
        run.stepKind ?? rule?.stepKind ?? defaultStepKind(run.kind, run.offsetMinutes);
      const laterBooking =
        stepOfRun === 'rebook' && row?.contactId != null
          ? await this.runs.hasLaterBooking(tx, orgId, row.id, row.contactId, row.endsAt)
          : false;
      return { run, row: row ?? null, rule, typeReminderBody, laterBooking };
    });
  }

  private async work(orgId: number, id: number, now: Date): Promise<void> {
    const loaded = await this.load(orgId, id);
    if (!loaded) return;
    const { run, row, rule, typeReminderBody, laterBooking } = loaded;
    const step = run.stepKind ?? rule?.stepKind ?? defaultStepKind(run.kind, run.offsetMinutes);

    if (!row) {
      await this.finish(orgId, run.id, null, run.kind, step, {
        status: 'cancelled',
        reason: 'booking_cancelled',
        channel: null,
      });
      return;
    }

    const gate = gateRun({
      runStatus: run.status,
      kind: run.kind,
      stepKind: step,
      rule: rule ? { isActive: rule.isActive, skipIfConfirmed: rule.skipIfConfirmed } : null,
      runArmedAtMs: run.armedAt.getTime(),
      bookingArmedAtMs: row.armedAt.getTime(),
      bookingStatus: row.status,
      startsAtMs: row.startsAt.getTime(),
      dueAtMs: run.dueAt.getTime(),
      nowMs: now.getTime(),
      customerConfirmed: row.customerConfirmedAt !== null,
      hasJoinLink: !!row.meetUrl,
    });
    if (!gate.go) {
      await this.finish(orgId, run.id, row, run.kind, step, {
        status: gate.status,
        reason: gate.reason,
        channel: null,
      });
      return;
    }
    // The rebook (recall) steps are a plan feature: a plan without it never sends one, and the run says why.
    if (
      step === 'rebook' &&
      !(await this.entitlements.featureEnabled(orgId, REMINDER_REBOOK_FEATURE))
    ) {
      await this.finish(orgId, run.id, row, run.kind, step, {
        status: 'skipped',
        reason: 'plan_feature_locked',
        channel: null,
      });
      return;
    }
    if (laterBooking) {
      await this.finish(orgId, run.id, row, run.kind, step, {
        status: 'skipped',
        reason: 'already_rebooked',
        channel: null,
      });
      return;
    }
    if (!rule || run.attempts > REMINDER_MAX_ATTEMPTS) {
      await this.finish(orgId, run.id, row, run.kind, step, {
        status: 'failed',
        reason: rule ? 'expired' : 'internal_error',
        channel: null,
      });
      return;
    }

    const tried = await this.tryChannels(
      orgId,
      run,
      row,
      rule,
      step,
      typeReminderBody,
      rule.channels,
    );
    const settled = settleChannels(tried, now);
    const sent = tried.find((t) => t.outcome.status === 'sent');
    const messageRef =
      sent?.channel === 'whatsapp' &&
      sent.outcome.status === 'sent' &&
      sent.outcome.providerMessageId &&
      UUID.test(sent.outcome.providerMessageId)
        ? sent.outcome.providerMessageId
        : null;
    await this.finish(orgId, run.id, row, run.kind, step, settled, run.reason, {
      attemptLog: attemptLogOf(tried),
      messageRef,
      deliveryCheckAt: messageRef ? new Date(now.getTime() + FIRST_DELIVERY_CHECK_MS) : null,
    });
  }

  /**
   * Tries `channels` in order (the fallback rule). Stops at the first that sent or that is held; a channel that was skipped or failed
   * hands over to the next. Never throws: an unexpected error in a channel is that channel's failure.
   */
  private async tryChannels(
    orgId: number,
    run: RunRow,
    row: AppointmentRow,
    rule: RuleRow,
    step: BookingReminderStepKind,
    typeReminderBody: string | null,
    channels: readonly BookingReminderChannel[],
  ): Promise<Array<{ channel: BookingReminderChannel; outcome: ChannelOutcome }>> {
    const facts: MessageFacts = {
      typeName: row.bookingTypeName ?? row.title,
      title: row.title,
      inviteeName: row.inviteeName,
      startsAtMs: row.startsAt.getTime(),
      timezone: row.timezone,
      location: row.meetUrl ?? row.location,
      manageUrl: this.support.manageUrlOf(row),
      joinUrl: row.meetUrl,
      hostName: row.hostName,
      hostPhone: row.hostPhone,
      serviceLabel: rule.serviceLabel,
    };
    const vars = variablesFor(facts);
    const tried: Array<{ channel: BookingReminderChannel; outcome: ChannelOutcome }> = [];
    // Confirm / Reschedule / Cancel buttons: only on a WhatsApp template, and only when the plan has them.
    const quickReplyPayloads =
      channels.includes('whatsapp') && rule.buttonsEnabled && rule.waTemplateUuid
        ? (await this.replies.buttonsAllowed(orgId))
          ? await this.replies.payloadsFor(orgId, run.id)
          : undefined
        : undefined;
    for (const channel of channels) {
      const { body, subject } = this.textFor(channel, rule, step, typeReminderBody, facts, vars);
      const message: BookingMessage = {
        orgId,
        appointmentId: row.uuid,
        event: eventOf(step),
        channel,
        to: { name: row.inviteeName, phone: row.inviteePhone, email: row.inviteeEmail },
        body,
        subject,
        waTemplateId: rule.waTemplateUuid,
        variableMap: null,
        // Stable per (booking, arming, step, channel): a retry is the same message, a reschedule is a new one.
        idempotencyKey: `apptrem:${row.uuid}:${run.armedAt.getTime()}:${run.kind}:${run.offsetMinutes}:${channel}`,
        contactId: row.contactUuid,
        variables: vars,
        purpose: purposeOf(step),
        notAfter: run.kind === 'before' ? row.startsAt.toISOString() : null,
        ...(channel === 'whatsapp' && quickReplyPayloads ? { quickReplyPayloads } : {}),
      };
      let outcome: ChannelOutcome;
      try {
        outcome = outcomeOfResult(await this.messenger.send(message));
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : 'unknown', orgId, id: run.id },
          'reminder channel failed unexpectedly',
        );
        outcome = { status: 'failed', reason: 'internal_error' };
      }
      tried.push({ channel, outcome });
      if (outcome.status === 'sent' || outcome.status === 'held') break;
    }
    return tried;
  }

  /**
   * What the step says on a channel. Email: the library message the step chose (read now, so editing it changes what goes out), else the
   * step's own text, else the built-in one. WhatsApp free text (inside the 24 hour window): the step's own text, else the words of its
   * template, else the built-in one.
   */
  textFor(
    channel: BookingReminderChannel,
    rule: RuleRow,
    step: BookingReminderStepKind,
    typeReminderBody: string | null,
    facts: MessageFacts,
    vars: Record<string, string>,
  ): { body: string; subject: string } {
    const defaultSubject = `${facts.typeName}: ${SUBJECTS[step]}`;
    if (channel === 'email' && rule.library?.active) {
      return {
        body: renderTemplate(rule.library.body, vars),
        subject: rule.library.subject?.trim()
          ? renderTemplate(rule.library.subject, vars)
          : defaultSubject,
      };
    }
    const fromTemplate =
      channel === 'whatsapp' && rule.waTemplateBody ? namedBodyOf(rule.waTemplateBody) : null;
    return {
      body: stepBody(step, rule.body ?? fromTemplate, typeReminderBody, facts),
      subject: rule.subject?.trim() || defaultSubject,
    };
  }

  // --- what the provider reports afterwards -------------------------------------------------------------------------------------

  /** One pass of the delivery watch: looks at the WhatsApp messages that were handed over. Returns how many it looked at. */
  async watchDelivery(limit: number, now: Date = new Date()): Promise<number> {
    const taken = await this.db.privileged((tx) => this.runs.takeDeliveryChecks(tx, limit));
    for (const { orgId, id } of taken) {
      try {
        await RequestContextStore.run(
          {
            requestId: `appointment-delivery-${id}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () => this.checkDelivery(orgId, id, now),
        );
      } catch (err) {
        this.logger.error({ err, orgId, id }, 'delivery check failed unexpectedly');
      }
    }
    return taken.length;
  }

  private async checkDelivery(orgId: number, id: number, now: Date): Promise<void> {
    const loaded = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const run = await this.runs.findRun(tx, orgId, id);
      if (!run || run.status !== 'sent' || run.delivery !== 'unknown' || !run.messageRef)
        return null;
      const state = await this.runs.messageState(tx, orgId, run.messageRef);
      return { run, state };
    });
    if (!loaded) return;
    const { run, state } = loaded;
    const stop = (delivery: 'unknown' | 'delivered' | 'failed' | 'undelivered', at?: Date | null) =>
      this.db.txAs({ orgId, userId: null }, (tx) =>
        this.runs.recordDelivery(tx, orgId, id, {
          delivery,
          deliveredAt: at ?? null,
          checkAt: null,
        }),
      );

    if (!state) return stop('unknown');
    if (state.status === 'delivered' || state.status === 'read') {
      return stop('delivered', state.deliveredAt ?? now);
    }
    const sentAt = run.sentAt ?? now;
    if (state.status === 'failed') {
      await this.fallBack(orgId, run, 'failed', 'send_failed', now);
      return;
    }
    // Handed over and not reported delivered yet.
    const rule = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.runs.findRule(tx, orgId, run.reminderId),
    );
    const minutes = rule?.undeliveredFallbackMinutes ?? null;
    if (minutes !== null && now.getTime() >= sentAt.getTime() + minutes * 60_000) {
      await this.fallBack(orgId, run, 'undelivered', 'not_delivered', now);
      return;
    }
    const giveUpAt = sentAt.getTime() + Math.max(minutes ?? 0, WATCH_LIMIT_MS / 60_000) * 60_000;
    if (now.getTime() >= giveUpAt) return stop('unknown');
    const wake = minutes !== null ? sentAt.getTime() + minutes * 60_000 : Infinity;
    const next = new Date(Math.min(now.getTime() + NEXT_DELIVERY_CHECK_MS, wake));
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.runs.recordDelivery(tx, orgId, id, { delivery: 'unknown', checkAt: next }),
    );
  }

  /**
   * The WhatsApp message did not arrive: send the step on the channels after the one that was used, if the booking still calls for it.
   * The log keeps the WhatsApp line (as failed, with the reason) and adds what the next channels did.
   */
  private async fallBack(
    orgId: number,
    run: RunRow,
    delivery: 'failed' | 'undelivered',
    reason: 'send_failed' | 'not_delivered',
    now: Date,
  ): Promise<void> {
    const loaded = await this.load(orgId, run.id, 'sent');
    const log: AttemptEntry[] = run.attemptLog.map((e) =>
      e.channel === run.channel && e.status === 'sent' ? { ...e, status: 'failed', reason } : e,
    );
    const done = (v: {
      status?: 'failed';
      channel?: BookingReminderChannel;
      messageRef?: string;
    }) =>
      this.db.txAs({ orgId, userId: null }, async (tx) => {
        await this.runs.recordDelivery(tx, orgId, run.id, {
          delivery,
          checkAt: null,
          attemptLog: log,
          ...(v.channel ? { channel: v.channel } : {}),
          ...(v.messageRef ? { messageRef: v.messageRef } : {}),
        });
        // A message that failed outright with nowhere to go is a failed run (one that is merely late may still arrive).
        if (v.status === 'failed') await this.runs.failAfterSend(tx, orgId, run.id, reason);
      });
    if (!loaded?.row || !loaded.rule) {
      await done(delivery === 'failed' ? { status: 'failed' } : {});
      return;
    }
    const { row, rule, typeReminderBody } = loaded;
    const step = run.stepKind ?? rule.stepKind;
    const gate = gateRun({
      runStatus: 'sent',
      kind: run.kind,
      stepKind: step,
      rule: { isActive: rule.isActive, skipIfConfirmed: false },
      runArmedAtMs: run.armedAt.getTime(),
      bookingArmedAtMs: row.armedAt.getTime(),
      bookingStatus: row.status,
      startsAtMs: row.startsAt.getTime(),
      dueAtMs: run.dueAt.getTime(),
      nowMs: now.getTime(),
      customerConfirmed: row.customerConfirmedAt !== null,
      hasJoinLink: !!row.meetUrl,
    });
    const index = rule.channels.indexOf((run.channel ?? 'whatsapp') as BookingReminderChannel);
    const rest = gate.go ? rule.channels.slice(index + 1) : [];
    if (rest.length === 0) {
      await done(delivery === 'failed' ? { status: 'failed' } : {});
      return;
    }
    const tried = await this.tryChannels(orgId, run, row, rule, step, typeReminderBody, rest);
    log.push(...attemptLogOf(tried));
    const winner = tried.find((t) => t.outcome.status === 'sent');
    if (!winner) {
      await done(delivery === 'failed' ? { status: 'failed' } : {});
      return;
    }
    const ref =
      winner.channel === 'whatsapp' &&
      winner.outcome.status === 'sent' &&
      winner.outcome.providerMessageId &&
      UUID.test(winner.outcome.providerMessageId)
        ? winner.outcome.providerMessageId
        : undefined;
    await done({ channel: winner.channel, ...(ref ? { messageRef: ref } : {}) });
  }

  // --- the outcome --------------------------------------------------------------------------------------------------------------

  /** Writes the outcome of a run: the row, the audit trail, the timeline and an outbox event, in one transaction. */
  private async finish(
    orgId: number,
    runId: number,
    row: AppointmentRow | null,
    kind: BookingReminderKind,
    step: BookingReminderStepKind,
    outcome: Settled | { status: 'cancelled' | 'skipped'; reason: ReminderReason; channel: null },
    previousReason: string | null = null,
    extra: {
      attemptLog?: AttemptEntry[];
      messageRef?: string | null;
      deliveryCheckAt?: Date | null;
    } = {},
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
        ...(extra.attemptLog ? { attemptLog: extra.attemptLog } : {}),
        ...(extra.messageRef ? { messageRef: extra.messageRef } : {}),
        ...(extra.deliveryCheckAt ? { deliveryCheckAt: extra.deliveryCheckAt } : {}),
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
            step,
            reason: outcome.reason ?? null,
            channel: outcome.channel ?? null,
          },
        });
        // A cancelled run is the booking's own change (already on its timeline); it is not repeated per rule.
        if (row.contactId !== null && outcome.status !== 'cancelled') {
          const entry = timelineEntry(
            kind,
            outcome.status,
            outcome.channel,
            outcome.reason,
            until,
            step,
          );
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

  /** Whatever we did not foresee: the run is closed as failed, never retried blindly (an email may already have gone). */
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
