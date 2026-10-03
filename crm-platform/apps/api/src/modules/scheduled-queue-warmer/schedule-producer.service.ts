import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { SenderResolver } from '../node-bridge-runtime';
import { cleanNumber } from './audience/schedule-audience.service';
import { wallParts } from './schedule-time';

export interface ProducedSchedule {
  orgId: number;
  /** The producer's own id for this schedule (a cart, an appointment reminder). Registering the same key again replaces the old one. */
  key: string;
  /** Who made it: `cart_recovery`, `appointment_reminder`, ... Lets the list label or hide system schedules. */
  source: string;
  name: string;
  /** Numbers to message; anything that is not a valid number is dropped. */
  phones: readonly string[];
  message: string;
  runAt: Date;
  /** The zone the schedule is shown in. UTC by default. */
  timezone?: string;
  /** A sender to use; by default the workspace's newest connected number. */
  sender?: { engine?: string; deviceId?: number };
}

/**
 * The door other domains use to schedule a message without the composer (TW-SCHED-030): abandoned-cart recovery, appointment
 * reminders. It writes an ordinary schedule, so the run, the pacing, the receipts and the list all treat it like any other; it
 * skips the composer's plan, wallet and warmer-reservation checks, as Reference's producers did (the send itself is still guarded
 * and paced by the sender).
 *
 * Unlike Reference, appointment-style reminders are rows (not bridge memory): they survive a restart and are visible, and the key
 * makes a reschedule replace the old reminder, never add a second.
 */
@Injectable()
export class ScheduleProducerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly senders: SenderResolver,
  ) {}

  async produce(input: ProducedSchedule): Promise<{ id: string; replaced: boolean }> {
    const phones = [
      ...new Set(input.phones.map(cleanNumber).filter((p): p is string => p !== null)),
    ];
    if (phones.length === 0) throw AppError.validation('No valid phone number to message.');
    if (!input.message.trim()) throw AppError.validation('The message is empty.');
    const zone = input.timezone ?? 'UTC';
    const { date, time } = wallParts(input.runAt, zone);
    return this.db.txAs({ orgId: input.orgId, userId: null }, async (tx) => {
      const sender = await this.senders.resolve(tx, input.orgId, {
        provider: input.sender?.engine ?? null,
        deviceId: input.sender?.deviceId ?? null,
      });
      if (!sender) throw AppError.validation('No connected number to send from.');
      // The old schedule under this key: a waiting one is cancelled and replaced; one that already ran just gives up the key.
      const old = await tx.execute(sql`
        SELECT id, status FROM scheduled_messages
         WHERE org_id = ${input.orgId} AND external_key = ${input.key} FOR UPDATE`);
      const prev = old.rows[0] as { id: number | string; status: string } | undefined;
      if (prev) {
        await tx.execute(sql`
          UPDATE scheduled_messages
             SET external_key = NULL,
                 status = CASE WHEN status IN ('scheduled', 'paused') THEN 'cancelled' ELSE status END,
                 next_attempt_at = NULL
           WHERE org_id = ${input.orgId} AND id = ${Number(prev.id)}`);
      }
      const row = await tx.execute(sql`
        INSERT INTO scheduled_messages
          (org_id, device_id, schedule_name, message_content, template_type, schedule_type, send_date, send_time, scheduled_time,
           timezone, recipient_type, target_numbers, total_recipients, from_number, status, next_run_at, provider, source, external_key)
        VALUES
          (${input.orgId}, ${sender.id}, ${input.name.slice(0, 255)}, ${input.message}, 'text', 'once', ${date}::date, ${time},
           ${input.runAt.toISOString()}::timestamptz, ${zone}, 'number', ${JSON.stringify(phones)}::jsonb, ${phones.length},
           ${sender.phoneDigits}, 'scheduled', ${input.runAt.toISOString()}::timestamptz, ${sender.engine}, ${input.source}, ${input.key})
        RETURNING id, uuid`);
      const created = row.rows[0] as { id: number | string; uuid: string };
      await tx.execute(sql`
        INSERT INTO scheduled_message_contacts (org_id, scheduled_message_id, phone)
        VALUES ${sql.join(
          phones.map((p) => sql`(${input.orgId}, ${Number(created.id)}, ${p})`),
          sql`, `,
        )}`);
      return { id: created.uuid, replaced: prev !== undefined };
    });
  }

  /** Cancels the schedule registered under `key`, only while it is still waiting (a reminder that already went cannot be recalled). */
  async cancel(orgId: number, key: string): Promise<boolean> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE scheduled_messages SET status = 'cancelled', external_key = NULL, next_attempt_at = NULL
         WHERE org_id = ${orgId} AND external_key = ${key} AND status IN ('scheduled', 'paused') RETURNING id`);
      return res.rows.length > 0;
    });
  }
}
