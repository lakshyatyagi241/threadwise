import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CONVERSATIONS_FACADE,
  InboundMessageHooks,
  type ConversationsFacade,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../chat-conversations';
import { ContactActivitiesRepository } from '../crm';
import { ReminderPlan } from './reminder-plan';
import {
  AppointmentRemindersRepository,
  type ReplyAction,
  type ReplyState,
} from './appointment-reminders.repository';
import { AppointmentsRepository } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';
import { BookingService } from './booking.service';
import {
  REPLY_ACTIONS,
  REPLY_PAYLOAD_MAX,
  decideReply,
  openReplyToken,
  replyText,
  sealReplyToken,
  type ReplyOutcome,
} from './reminder-reply.rules';
import { formatClock, formatDateLong } from './tz';

const ORDER: readonly ReplyAction[] = ['confirm', 'reschedule', 'cancel'];
const ctxOf = (orgId: number) => `appt-reply:${orgId}`;

/** A stable uuid-shaped id from a string (the outbound path wants a uuid as the client's message id). */
function uuidOfKey(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The customer's quick reply to a reminder (BL-426): Confirm, Reschedule and Cancel buttons on the 24 hour reminder.
 *
 * Out: `payloadsFor` gives the three signed one-time tokens a WhatsApp reminder carries as its quick-reply payloads (only when the plan
 * has the feature `appointment_confirm_buttons`). In: this is a listener of the existing inbound pipeline (no new webhook): a tap
 * arrives as a stored message with the payload in its meta, is matched to the run and the booking, and does what the button says:
 *
 *  - Confirm: the booking records that the customer will come (`customer_confirmed_at`, an audit row, an event, a line on the contact's
 *    timeline); it skips a "skip if already confirmed" reminder and counts in the reports.
 *  - Cancel: the booking is cancelled through the booking service, as the customer's own cancel on the manage page is (not after the
 *    start, the cancel fee is recorded as the type says), the waiting reminders stop and the host is told.
 *  - Reschedule: the answer carries the manage link.
 *
 * Every tap is answered in the thread in one sentence. A token is bound to its run and nonce (a forged or edited one is ignored), to the
 * contact (a tap from anyone else does nothing), used once (a second tap gets the same answer and no second action) and expires at
 * the booking's start. Runs in the worker process, after the consent keyword check and before any flow, FAQ or AI answer.
 */
@Injectable()
export class ReminderReplyService implements InboundMessageListener, OnModuleInit {
  readonly name = 'appointment-reply';
  readonly first = true as const;
  private readonly logger = new Logger(ReminderReplyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly hooks: InboundMessageHooks,
    private readonly crypto: CryptoService,
    private readonly runs: AppointmentRemindersRepository,
    private readonly appts: AppointmentsRepository,
    private readonly booking: BookingService,
    private readonly support: AppointmentsSupport,
    private readonly activities: ContactActivitiesRepository,
    private readonly plan: ReminderPlan,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  // --- out ----------------------------------------------------------------------------------------------------------------------

  /** Whether the workspace's plan includes the buttons (the upgrade tier of the Appointments app). */
  async buttonsAllowed(orgId: number): Promise<boolean> {
    return (await this.plan.parts(orgId)).buttons;
  }

  /**
   * The three tokens of a run, in button order (Confirm, Reschedule, Cancel). The nonces are made once and kept on the run, so a
   * retried send carries tokens that mean the same thing.
   */
  async payloadsFor(orgId: number, runId: number): Promise<string[]> {
    const state = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const locked = await this.runs.lockReply(tx, orgId, runId);
      if (!locked) return null;
      const next: ReplyState = { ...locked.state };
      let changed = false;
      for (const a of ORDER) {
        if (!next[a]) {
          next[a] = { nonce: randomBytes(12).toString('base64url'), usedAt: null, outcome: null };
          changed = true;
        }
      }
      if (changed) await this.runs.saveReply(tx, orgId, runId, next);
      return next;
    });
    if (!state) return [];
    return ORDER.map((a) => {
      const payload = sealReplyToken((plain) => this.crypto.encrypt(plain, ctxOf(orgId)), {
        o: orgId,
        r: runId,
        a,
        n: state[a]!.nonce,
      });
      if (payload.length > REPLY_PAYLOAD_MAX) throw new Error('reply payload too long');
      return payload;
    });
  }

  // --- in -----------------------------------------------------------------------------------------------------------------------

  async onStored(e: InboundStoredEvent): Promise<{ consumed: boolean; halt?: boolean }> {
    const payload = e.message.meta.buttonPayload;
    if (typeof payload !== 'string' || e.channelKind === 'email') return { consumed: false };
    const token = openReplyToken((c) => this.crypto.decrypt(c, ctxOf(e.orgId)), payload);
    // Not one of ours: someone else's button (a flow's own) is left to them.
    if (!payload.startsWith('ap1:')) return { consumed: false };
    // Ours but not valid (forged, edited, another workspace's): answered with nothing, and no bot answers it either.
    if (!token || token.o !== e.orgId || !REPLY_ACTIONS.includes(token.a)) {
      this.logger.warn(
        { orgId: e.orgId },
        'a reminder button came back with a token that is not valid',
      );
      return { consumed: true, halt: true };
    }
    try {
      await RequestContextStore.run(
        {
          requestId: `appointment-reply-${e.messageUuid}`,
          orgId: e.orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () => this.apply(e, token.r, token.a, token.n),
      );
    } catch (err) {
      this.logger.error(
        { orgId: e.orgId, err: err instanceof Error ? err.message : String(err) },
        'a reminder button could not be applied',
      );
    }
    return { consumed: true, halt: true };
  }

  private async apply(
    e: InboundStoredEvent,
    runId: number,
    action: ReplyAction,
    nonce: string,
  ): Promise<void> {
    const orgId = e.orgId;
    const nowMs = Date.now();
    const done = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const locked = await this.runs.lockReply(tx, orgId, runId);
      const entry = locked?.state[action];
      // Unknown run, or a nonce this run never issued: not a token we made.
      if (!locked || !entry || entry.nonce !== nonce) return null;
      const probe = await this.appts.findById(tx, orgId, locked.appointmentId);
      if (!probe) return null;
      const row = await this.appts.findByUuid(tx, orgId, probe.uuid, true);
      if (!row) return null;
      const rule = await this.runs.findRule(
        tx,
        orgId,
        (await this.runs.findRun(tx, orgId, runId))?.reminderId ?? null,
      );

      const decision = decideReply({
        action,
        sameContact: row.contactId !== null && row.contactId === e.contactId,
        usedOutcome: entry.usedAt
          ? ((entry.outcome as ReplyOutcome | null) ?? 'not_available')
          : null,
        status: row.status,
        startsAtMs: row.startsAt.getTime(),
        nowMs,
        customerConfirmed: row.customerConfirmedAt !== null,
      });
      if (decision.kind === 'ignore') return null;

      let outcome: ReplyOutcome = decision.outcome;
      if (decision.kind === 'act') {
        if (decision.effect === 'confirm') {
          const ok = await this.appts.update(tx, orgId, row.id, row.rowVersion, {
            customer_confirmed_at: new Date(nowMs).toISOString(),
          });
          if (!ok) throw AppError.rowVersionConflict('Appointment');
          const after = (await this.appts.findById(tx, orgId, row.id))!;
          await this.support.record(tx, after, {
            orgId,
            audit: {
              action: 'update',
              delta: { customerConfirmedAt: { old: null, new: new Date(nowMs).toISOString() } },
            },
            event: { type: 'appointment.customer_confirmed', extra: { via: 'reminder_reply' } },
          });
          if (row.contactId !== null) {
            await this.activities.insert(tx, orgId, {
              contactId: row.contactId,
              activityType: 'appointment_reminder',
              title: 'Customer confirmed the appointment',
              body: 'They tapped Confirm on the reminder.',
              source: 'system',
              actorId: null,
            });
          }
        } else if (decision.effect === 'cancel') {
          try {
            await this.booking.transition(tx, orgId, row, 'cancelled', {
              by: 'invitee',
              reason: 'Cancelled by the customer from a reminder',
              notify: true,
              nowMs,
              via: 'reminder_reply',
            });
            if (row.contactId !== null) {
              await this.activities.insert(tx, orgId, {
                contactId: row.contactId,
                activityType: 'appointment_reminder',
                title: 'Customer cancelled the appointment',
                body: 'They tapped Cancel on the reminder.',
                source: 'system',
                actorId: null,
              });
            }
          } catch (err) {
            // A transition the status machine refuses (it changed under us): nothing to cancel any more.
            if (!(err instanceof AppError)) throw err;
            outcome = 'not_available';
          }
        }
        if (decision.remember && outcome === decision.outcome) {
          const next: ReplyState = {
            ...locked.state,
            [action]: { ...entry, usedAt: new Date(nowMs).toISOString(), outcome },
          };
          await this.runs.saveReply(tx, orgId, runId, next);
        }
      } else {
        outcome = decision.outcome;
      }
      const date = formatDateLong(row.startsAt.getTime(), row.timezone);
      const time = formatClock(row.startsAt.getTime(), row.timezone);
      return {
        text: replyText(outcome, rule?.waTemplateLanguage ?? null, {
          date,
          time,
          manageLink: this.support.manageUrlOf(row),
        }),
      };
    });
    if (!done) return;
    await this.reply(e, done.text);
  }

  private async reply(e: InboundStoredEvent, body: string): Promise<void> {
    try {
      await this.conversations.enqueueOutbound({
        conversationId: e.conversationUuid,
        // One answer per tap, however often the job is retried.
        clientMessageId: uuidOfKey(`apptreply-${e.messageUuid}`),
        content: { kind: 'text', body },
        sender: { kind: 'bot' },
      });
    } catch (err) {
      // The action is already recorded; a closed window or a channel that is down only loses the sentence.
      this.logger.warn(
        { orgId: e.orgId, id: randomUUID(), err: err instanceof Error ? err.message : String(err) },
        'the answer to a reminder button could not be queued',
      );
    }
  }
}
