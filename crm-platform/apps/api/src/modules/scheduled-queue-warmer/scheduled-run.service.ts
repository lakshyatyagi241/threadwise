import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type ConsentGateResult, type PurposeInput } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  PACING_SETTINGS,
  PacingRuntime,
  CapTally,
  SenderLease,
  WALLET_GATE,
  type WalletGate,
  assemblePhone,
  batchCooldownMs,
  batchingApplies,
  capRemaining,
  nextGapMs,
  nextUtcMidnight,
  type PacingSettingsSource,
} from '../broadcasts';
import { ConsentGate, purposeOfCategory } from '../contact-consent';
import { MergeTagService } from '../crm';
import {
  OutboundRegistry,
  SenderResolver,
  UnsupportedSendError,
  type OpenTransport,
} from '../node-bridge-runtime';
import { dateOnly, isRecurring, runAt, weekdays, type ScheduledRow } from './scheduled-message';
import { deliveryProviderOf, emitDeliveryReported } from '../../kernel/outbox/delivery-report';
import { ScheduleMessageBuilder, type PreparedMessage } from './schedule-message-builder.service';
import { nextRun } from './schedule-time';
import { emitScheduledStatus } from './scheduled-events';
import { spin } from './warmer/warmer-rules';
import { WarmerService } from './warmer/warmer.service';

export type RunResult = 'skipped' | 'failed' | 'busy' | 'paused' | 'stopped' | 'finished';

const BATCH = 50;
const STALE_CLAIM_MINUTES = 10;
const HEARTBEAT_MS = 20_000;
/** When a run stopped by the emergency halt looks again. The halt has no known end, so it polls. */
const HALT_RETRY_MS = 5 * 60_000;

interface Recipient {
  id: number | string;
  phone: string;
  contact_id: number | string | null;
}

const digits = (s: string) => s.replace(/\D+/g, '');

/**
 * Runs one occurrence of a scheduled message (TW-NODE-031, 032, 033).
 *
 * The job carries only the ids; this re-reads the row. Safe to run twice: every recipient is claimed (`pending` to
 * `processing`) before the provider is called, so a retry after a crash never messages the same person again, and a claim
 * older than STALE_CLAIM_MINUTES is failed as interrupted rather than sent again. The pacing, the daily cap, the one run per
 * number and the emergency halt are the broadcast sender's, shared: a number is never in two runs at once.
 */
@Injectable()
export class ScheduledRunService {
  private readonly logger = new Logger(ScheduledRunService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly resolver: SenderResolver,
    private readonly outbound: OutboundRegistry,
    private readonly merge: MergeTagService,
    private readonly builder: ScheduleMessageBuilder,
    @Inject(PACING_SETTINGS) private readonly pacingSettings: PacingSettingsSource,
    private readonly runtime: PacingRuntime,
    private readonly cap: CapTally,
    private readonly lease: SenderLease,
    private readonly warmer: WarmerService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    private readonly outbox: OutboxService,
    @Inject(WALLET_GATE) private readonly wallet: WalletGate,
    private readonly consentGate: ConsentGate,
  ) {}

  /** Must run inside a request context for `orgId` (the processor sets it from the job). */
  async run(orgId: number, scheduledId: number): Promise<RunResult> {
    const prep = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, status, schedule_type, scheduled_time, next_run_at, timezone, repeat_interval, repeat_every,
               days_of_week, end_date, template_type, template_id, template_overrides, message_content, media_file, latitude, longitude, provider,
               device_id, send_attempts, recipients_spent
        FROM scheduled_messages WHERE org_id = ${orgId} AND id = ${scheduledId} FOR UPDATE`);
      const row = res.rows[0] as unknown as ScheduledRow | undefined;
      if (!row || !['scheduled', 'running'].includes(row.status)) return { skip: true as const };
      // The unofficial engine is off (owner decision 2026-10-05): nothing is sent and the row is only handed back to the due sweep
      // (`scheduled`, no job), which skips it until the engine is turned on. No recipient is touched, nothing is marked failed.
      if (row.provider === UNOFFICIAL_ENGINE && !(await this.unofficial.isEnabledFor(orgId))) {
        await tx.execute(sql`
          UPDATE scheduled_messages SET status = 'scheduled', node_schedule_id = NULL
           WHERE org_id = ${orgId} AND id = ${scheduledId}`);
        this.logger.warn({ orgId, scheduledId }, '[SCHED] not sent: the unofficial engine is off');
        return { skip: true as const };
      }
      await tx.execute(
        sql`UPDATE scheduled_messages SET status = 'running' WHERE org_id = ${orgId} AND id = ${scheduledId}`,
      );

      const fail = async (reason: string) => {
        this.logger.warn({ orgId, scheduledId, reason }, '[SCHED] run failed');
        await this.markFailed(tx, orgId, scheduledId, reason);
        return { skip: false as const, failed: true as const };
      };

      const sender = await this.resolver.resolve(tx, orgId, {
        provider: row.provider,
        deviceId: row.device_id === null ? null : Number(row.device_id),
      });
      if (!sender) return fail('Client not found');
      const transport = this.outbound.get(sender.engine);
      if (!transport) return fail(`No sender for the ${sender.engine} engine`);
      // A warming number only sends inside its active hours: wait and look again, never fail the schedule for it.
      if (!(await this.warmer.mayRunNow(tx, sender))) {
        await tx.execute(sql`
          UPDATE scheduled_messages SET status = 'paused', next_attempt_at = now() + interval '30 minutes',
                 last_error = 'Waiting for the number''s warmer active hours'
           WHERE org_id = ${orgId} AND id = ${scheduledId}`);
        return { skip: true as const };
      }

      // The recipients of the last occurrence were kept until now so the provider's late reports still found them; this occurrence starts
      // from the whole audience again.
      if (row.recipients_spent) {
        await tx.execute(sql`
          UPDATE scheduled_message_contacts
             SET status = 'pending', error_message = NULL, wa_message_id = NULL, sent_at = NULL,
                 delivered_at = NULL, read_at = NULL, failed_at = NULL
           WHERE org_id = ${orgId} AND scheduled_message_id = ${scheduledId}`);
        await tx.execute(
          sql`UPDATE scheduled_messages SET recipients_spent = false WHERE org_id = ${orgId} AND id = ${scheduledId}`,
        );
      }

      await tx.execute(sql`
        UPDATE scheduled_message_contacts SET status = 'failed', error_message = 'Send was interrupted before it finished', failed_at = now()
        WHERE org_id = ${orgId} AND scheduled_message_id = ${scheduledId} AND status = 'processing'
          AND updated_at < now() - ${`${STALE_CLAIM_MINUTES} minutes`}::interval`);
      const pending = await tx.execute(sql`
        SELECT count(*)::int AS n FROM scheduled_message_contacts
        WHERE org_id = ${orgId} AND scheduled_message_id = ${scheduledId} AND status = 'pending'`);
      const pendingTotal = Number((pending.rows[0] as { n: number }).n);
      if (pendingTotal === 0) return fail('No recipients');

      // What the message needs that is the same for everyone: the template and its approval, the file's link, the merge context. A message
      // that cannot be sent (a template Meta no longer approves, a file that is gone) fails the schedule once, here, with the reason.
      let prepared: PreparedMessage;
      try {
        prepared = await this.builder.prepare(tx, orgId, row, sender.engine);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      return {
        skip: false as const,
        failed: false as const,
        row,
        sender,
        transport,
        pacing: await this.pacingSettings.get(tx, orgId),
        warm: await this.warmer.gap(tx, sender),
        spinOn: await this.warmer.spintaxOn(tx, sender),
        prepared,
        pendingTotal,
      };
    });
    if (prep.skip) return 'skipped';
    if (prep.failed) return 'failed';
    const { row, sender, transport, pacing, warm, spinOn, prepared, pendingTotal } = prep;

    let opened: OpenTransport;
    try {
      opened = await transport.open(orgId, sender);
    } catch (err) {
      await this.db.tx((tx) =>
        this.markFailed(tx, orgId, scheduledId, err instanceof Error ? err.message : String(err)),
      );
      return 'failed';
    }

    const leaseKey = SenderLease.key(orgId, sender.engine, sender.id);
    const leaseToken = await this.lease.acquire(leaseKey);
    if (!leaseToken) return 'busy';
    const counts = { sent: 0, failed: 0 };
    try {
      const batching = batchingApplies(pacing, pendingTotal);
      let processed = 0;
      let sinceBatch = 0;
      let lastId = 0;
      for (;;) {
        // Cancelled or paused by hand while it ran: stop, and leave the row as the person set it.
        if (!(await this.stillRunning(orgId, scheduledId))) return 'stopped';
        const batch = await this.db.tx(async (tx) => {
          const res = await tx.execute(sql`
            SELECT id, phone, contact_id FROM scheduled_message_contacts
            WHERE org_id = ${orgId} AND scheduled_message_id = ${scheduledId} AND status = 'pending' AND id > ${lastId}
            ORDER BY id LIMIT ${BATCH}`);
          return res.rows as unknown as Recipient[];
        });
        if (batch.length === 0) break;

        // The consent gate runs NOW, at send time, not when the schedule was saved: a STOP since then, or a workspace that has since
        // switched on "require recorded consent", is honoured. One statement for the whole batch.
        const refused = await this.refusedByGate(orgId, batch, prepared);

        for (const r of batch) {
          lastId = Number(r.id);
          const to = digits(r.phone);

          const why = refused.get(Number(r.id));
          if (why) {
            await this.db.tx((tx) =>
              this.setRecipient(tx, orgId, Number(r.id), 'failed', { error: why }),
            );
            processed++;
            continue;
          }

          if (to && sender.engine === 'baileys') {
            const used = await this.cap.sentToday(orgId, sender.engine, sender.id);
            if (capRemaining(pacing.baileysDailyCap, used) <= 0) {
              const now = this.runtime.now();
              await this.pause(orgId, scheduledId, counts, nextUtcMidnight(now));
              this.logger.warn({ orgId, scheduledId, used }, '[SCHED] paused: daily cap reached');
              return 'paused';
            }
          }

          // The wallet must pay for this message: when it cannot, the run pauses (nobody is failed) and retries later.
          if (to) {
            try {
              await this.wallet.precheckSend(orgId, to, {
                source: 'scheduled',
                category: 'marketing',
              });
            } catch (err) {
              if (!(err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY)) throw err;
              await this.pause(
                orgId,
                scheduledId,
                counts,
                new Date(this.runtime.now().getTime() + HALT_RETRY_MS),
              );
              this.logger.warn(
                { orgId, scheduledId },
                '[SCHED] paused: wallet cannot cover the next message',
              );
              return 'paused';
            }
          }

          const claimed = await this.db.tx(async (tx) => {
            if (!to) {
              await this.setRecipient(tx, orgId, Number(r.id), 'failed', {
                error: 'No usable phone number',
              });
              counts.failed++;
              return false;
            }
            const res = await tx.execute(sql`
              UPDATE scheduled_message_contacts SET status = 'processing'
              WHERE org_id = ${orgId} AND id = ${Number(r.id)} AND status = 'pending' RETURNING id`);
            return res.rows.length > 0;
          });
          if (!claimed) {
            processed++;
            continue;
          }

          try {
            const contact =
              r.contact_id === null || !prepared.mergeBase
                ? undefined
                : await this.db.tx((tx) => this.merge.contactFor(tx, orgId, Number(r.contact_id)));
            // A warming number may vary the wording ({a|b}); spun after the merge tags, so a name is never touched.
            const command = this.builder.command(
              prepared,
              to,
              contact,
              spinOn ? (t) => spin(t, this.runtime.random) : undefined,
              `sched-${scheduledId}-${r.id}`,
            );
            const sent = await opened.send(command, {
              clientReference: `sched-${scheduledId}-${r.id}`,
              screen: { bulk: true, source: 'scheduled' },
            });
            await this.db.tx((tx) =>
              this.setRecipient(tx, orgId, Number(r.id), 'sent', {
                providerMessageId: sent.providerMessageId,
                report: {
                  scheduledId,
                  provider: row.provider,
                  category: prepared.template?.category ?? null,
                  phone: r.phone,
                },
              }),
            );
            counts.sent++;
            if (sender.engine === 'baileys') await this.cap.bump(orgId, sender.engine, sender.id);
          } catch (err) {
            if (err instanceof AppError && err.code === ERROR_CODES.AUTH_SEND_HALTED) {
              // The emergency halt is on: put this recipient back and stop. Nothing is lost.
              await this.db.tx((tx) => this.setRecipient(tx, orgId, Number(r.id), 'pending', {}));
              await this.pause(
                orgId,
                scheduledId,
                counts,
                new Date(this.runtime.now().getTime() + HALT_RETRY_MS),
              );
              this.logger.warn({ orgId, scheduledId }, '[SCHED] paused by the emergency halt');
              return 'paused';
            }
            const reason =
              err instanceof UnsupportedSendError || err instanceof Error
                ? err.message
                : String(err);
            await this.db.tx((tx) =>
              this.setRecipient(tx, orgId, Number(r.id), 'failed', { error: reason }),
            );
            counts.failed++;
          }

          processed++;
          if (processed < pendingTotal) {
            if (batching && ++sinceBatch >= pacing.batchSize) {
              sinceBatch = 0;
              await this.rest(batchCooldownMs(pacing, this.runtime.random), leaseKey, leaseToken);
            } else {
              await this.rest(nextGapMs(pacing, warm, this.runtime.random), leaseKey, leaseToken);
            }
          }
        }
      }
      await this.finish(orgId, row, counts);
      this.logger.log({ orgId, scheduledId, ...counts }, '[SCHED] run finished');
      return 'finished';
    } finally {
      await this.lease.release(leaseKey, leaseToken);
    }
  }

  /**
   * The recipients the ConsentGate refuses for this occurrence, with the plain reason kept on the recipient row. A schedule is
   * marketing unless its template is a utility or authentication one. Typed numbers that belong to no contact are decided on the
   * workspace policy alone (a withdrawn contact cannot be named, a missing grant is "no consent recorded").
   */
  private async refusedByGate(
    orgId: number,
    batch: readonly Recipient[],
    prepared: PreparedMessage,
  ): Promise<Map<number, string>> {
    const purpose: PurposeInput = prepared.template
      ? purposeOfCategory(prepared.template.category)
      : 'marketing_messaging';
    // Scheduled messages are WhatsApp (Cloud, Twilio or the linked number): one consent channel.
    const channel = 'whatsapp';
    const refused = new Map<number, string>();
    const reasonText = (d: ConsentGateResult): string =>
      d.reason === 'withdrawn'
        ? 'Not sent: the contact unsubscribed'
        : 'Not sent: no recorded consent';

    const ids = batch.filter((r) => r.contact_id !== null).map((r) => Number(r.contact_id));
    const many =
      ids.length > 0 ? await this.consentGate.checkMany(orgId, ids, channel, purpose) : null;
    const anyone = batch.some((r) => r.contact_id === null)
      ? await this.consentGate.check(orgId, { type: 'anonymous' }, channel, purpose)
      : null;
    for (const r of batch) {
      const d = r.contact_id === null ? anyone : many?.decisions.get(Number(r.contact_id));
      if (d && d.decision === 'deny') refused.set(Number(r.id), reasonText(d));
    }
    return refused;
  }

  private async stillRunning(orgId: number, scheduledId: number): Promise<boolean> {
    return this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT status FROM scheduled_messages WHERE org_id = ${orgId} AND id = ${scheduledId}`,
      );
      return (res.rows[0] as { status: string } | undefined)?.status === 'running';
    });
  }

  /** Recipient states only move up (pending, failed, sent), so a late write can never undo a later one (TW-NODE-035 rule 7). */
  private async setRecipient(
    tx: Parameters<Parameters<DatabaseService['tx']>[0]>[0],
    orgId: number,
    id: number,
    status: 'pending' | 'failed' | 'sent',
    extra: {
      error?: string;
      providerMessageId?: string | null;
      /** What the wallet needs to know about a send that went out. */
      report?: {
        scheduledId: number;
        provider: string | null;
        category: string | null;
        phone: string;
      };
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE scheduled_message_contacts
         SET status = ${status},
             error_message = ${status === 'failed' ? (extra.error ?? null) : null},
             wa_message_id = ${status === 'sent' ? (extra.providerMessageId ?? null) : null},
             sent_at = ${status === 'sent' ? sql`now()` : null},
             failed_at = ${status === 'failed' ? sql`now()` : null}
       WHERE org_id = ${orgId} AND id = ${id}`);
    // The wallet hears of the send in the same transaction. Only the unofficial engine bills on `sent`; the Cloud API and Twilio bill
    // when the provider reports delivery (the receipt below), so for them this writes nothing.
    const wamid = extra.providerMessageId;
    const provider = deliveryProviderOf(extra.report?.provider ?? 'baileys');
    if (status === 'sent' && wamid && extra.report && provider) {
      await emitDeliveryReported(this.outbox, tx, {
        orgId,
        aggregateModule: 'scheduled_messages',
        aggregateId: extra.report.scheduledId,
        report: {
          provider,
          providerMessageId: wamid,
          status: 'sent',
          recipient: assemblePhone(extra.report.phone, null) || null,
          category: extra.report.category,
          source: 'scheduled',
        },
      });
    }
  }

  private async markFailed(
    tx: Parameters<Parameters<DatabaseService['tx']>[0]>[0],
    orgId: number,
    scheduledId: number,
    reason: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE scheduled_messages
         SET status = 'failed', failed_at = now(), failure_reason = ${reason}, last_error = ${reason}
       WHERE org_id = ${orgId} AND id = ${scheduledId}`);
    await emitScheduledStatus(this.outbox, tx, orgId, scheduledId, 'failed', { reason });
  }

  /** A stop the system chose (daily cap, halt): the row waits, and the due poller resumes it at `resumeAt`. */
  private async pause(
    orgId: number,
    scheduledId: number,
    counts: { sent: number; failed: number },
    resumeAt: Date,
  ): Promise<void> {
    await this.db.tx((tx) =>
      tx.execute(sql`
        UPDATE scheduled_messages
           SET status = 'paused', next_attempt_at = ${resumeAt.toISOString()}::timestamptz,
               total_sent = total_sent + ${counts.sent}, total_failed = total_failed + ${counts.failed}
         WHERE org_id = ${orgId} AND id = ${scheduledId}`),
    );
  }

  /** Counts the run into the totals and moves the row on: the next occurrence, or the end. */
  private async finish(
    orgId: number,
    row: ScheduledRow,
    counts: { sent: number; failed: number },
  ): Promise<void> {
    const id = Number(row.id);
    await this.db.tx(async (tx) => {
      const now = this.runtime.now();
      if (isRecurring(row)) {
        const next = nextRun(runAt(row), {
          repeatInterval: row.repeat_interval,
          repeatEvery: row.repeat_every ?? 1,
          daysOfWeek: weekdays(row.days_of_week),
          endDate: dateOnly(row.end_date),
          timezone: row.timezone || 'UTC',
        });
        if (next) {
          // Every run reaches the whole audience again (Reference ignored later runs), but the recipients are only put back to "pending"
          // when that run starts (`recipients_spent`): until then each keeps the message id its late delivered/read/failed report is matched by.
          await tx.execute(sql`
            UPDATE scheduled_messages
               SET recipients_spent = true, status = 'scheduled', next_run_at = ${next.toISOString()}::timestamptz, last_run_at = ${now.toISOString()}::timestamptz,
                   next_attempt_at = NULL, node_schedule_id = NULL,
                   total_sent = total_sent + ${counts.sent}, total_failed = total_failed + ${counts.failed}
             WHERE org_id = ${orgId} AND id = ${id}`);
          return;
        }
      }
      // One-off, or the last occurrence: every recipient failing is a failed schedule, anything else is completed.
      const allFailed = counts.sent === 0 && counts.failed > 0;
      await tx.execute(sql`
        UPDATE scheduled_messages
           SET status = ${allFailed ? 'failed' : 'completed'},
               completed_at = ${allFailed ? null : sql`${now.toISOString()}::timestamptz`},
               failed_at = ${allFailed ? sql`${now.toISOString()}::timestamptz` : null},
               failure_reason = ${allFailed ? 'Every recipient failed' : null},
               last_run_at = ${now.toISOString()}::timestamptz, next_attempt_at = NULL,
               total_sent = total_sent + ${counts.sent}, total_failed = total_failed + ${counts.failed}
         WHERE org_id = ${orgId} AND id = ${id}`);
      await emitScheduledStatus(this.outbox, tx, orgId, id, allFailed ? 'failed' : 'completed', {
        reason: allFailed ? 'Every recipient failed' : null,
        sent: counts.sent,
        failed: counts.failed,
      });
    });
  }

  /** Waits `ms`, renewing the sender lease so a long rest does not give the number away. */
  private async rest(ms: number, leaseKey: string, token: string): Promise<void> {
    for (let left = ms; left > 0; left -= HEARTBEAT_MS) {
      await this.runtime.sleep(Math.min(left, HEARTBEAT_MS));
      await this.lease.renew(leaseKey, token);
    }
  }
}
