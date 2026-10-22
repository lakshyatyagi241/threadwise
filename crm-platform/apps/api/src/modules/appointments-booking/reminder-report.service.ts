import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  defaultStepKind,
  REMINDER_CONFIRM_BUTTONS_FEATURE,
  type BookingReminderKind,
  type BookingReminderStepKind,
  type ReminderReport,
  type ReminderReportQuery,
  type ReminderReportStep,
  type ReminderReportType,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { PlanEntitlementService } from '../plans-subscriptions-trials/plan-entitlement.service';
import { DatabaseService } from '../../infra/db/database.service';

type Raw = Record<string, unknown>;
const DAY = 86_400_000;
const num = (v: unknown): number => Number(v ?? 0);

/** A share of a whole; null when there is no whole (nothing was sent), never 0. */
export const rateOf = (part: number, whole: number): number | null =>
  whole <= 0 ? null : Math.round((part / whole) * 1000) / 1000;

const stepOf = (r: Raw): BookingReminderStepKind =>
  (r.step_kind as BookingReminderStepKind | null) ??
  defaultStepKind(r.kind as BookingReminderKind, num(r.offset_minutes));

/**
 * What the reminder sequences did (BL-429), per booking type and per step: how many were sent, delivered, failed and skipped (and why a
 * step was skipped), and, of the bookings a step was sent for, how many then confirmed, cancelled or became no-shows. Read from the run
 * table and the bookings in the window of the step's due time (default the last 30 days).
 *
 * `delivered` is what the provider reported for a WhatsApp message (`delivery = delivered`); an email has no delivery report, so it
 * counts as sent only. A rate is null when nothing was sent, never 0. Counts hold no personal data.
 */
@Injectable()
export class ReminderReportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async report(query: ReminderReportQuery): Promise<ReminderReport> {
    const { orgId } = RequestContextStore.require();
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY);
    // The button counts are part of the upgrade tier: a plan without the feature gets no counts (null), not zeros.
    const buttonsIncluded = await this.entitlements.featureEnabled(
      orgId,
      REMINDER_CONFIRM_BUTTONS_FEATURE,
    );
    return this.db.tx(async (tx) => {
      const scope = sql`r.org_id = ${orgId} AND r.due_at >= ${from.toISOString()} AND r.due_at < ${to.toISOString()}
        ${query.bookingTypeId ? sql`AND bt.uuid = ${query.bookingTypeId}::uuid` : sql``}`;
      const FROM = sql`FROM appointment_reminder_runs r
        JOIN appointments a ON a.org_id = r.org_id AND a.id = r.appointment_id
        JOIN booking_types bt ON bt.org_id = a.org_id AND bt.id = a.booking_type_id`;

      const counts = (
        await tx.execute(sql`
        SELECT bt.id AS type_id, bt.uuid AS type_uuid, bt.name AS type_name, r.step_kind, r.kind, r.offset_minutes,
               count(*) FILTER (WHERE r.status = 'sent') AS sent,
               count(*) FILTER (WHERE r.status = 'sent' AND r.delivery = 'delivered') AS delivered,
               count(*) FILTER (WHERE r.status = 'failed') AS failed,
               count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
               count(*) FILTER (WHERE r.status = 'sent' AND jsonb_array_length(r.attempt_log) > 1
                                  AND jsonb_path_exists(r.attempt_log, '$[*] ? (@.status == "sent")')) AS fallback_used,
               count(*) FILTER (WHERE r.reply_state -> 'confirm' ->> 'usedAt' IS NOT NULL) AS btn_confirm,
               count(*) FILTER (WHERE r.reply_state -> 'reschedule' ->> 'usedAt' IS NOT NULL) AS btn_reschedule,
               count(*) FILTER (WHERE r.reply_state -> 'cancel' ->> 'usedAt' IS NOT NULL) AS btn_cancel
        ${FROM} WHERE ${scope}
        GROUP BY bt.id, bt.uuid, bt.name, r.step_kind, r.kind, r.offset_minutes`)
      ).rows as Raw[];

      const reasons = (
        await tx.execute(sql`
        SELECT bt.id AS type_id, r.step_kind, r.kind, r.offset_minutes, r.reason, count(*) AS n
        ${FROM} WHERE ${scope} AND r.status = 'skipped'
        GROUP BY bt.id, r.step_kind, r.kind, r.offset_minutes, r.reason`)
      ).rows as Raw[];

      const outcomes = (
        await tx.execute(sql`
        SELECT bt.id AS type_id, r.step_kind, r.kind, r.offset_minutes,
               count(DISTINCT a.id) AS total,
               count(DISTINCT a.id) FILTER (WHERE a.customer_confirmed_at IS NOT NULL) AS confirmed,
               count(DISTINCT a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled,
               count(DISTINCT a.id) FILTER (WHERE a.status = 'no_show') AS no_show
        ${FROM} WHERE ${scope} AND r.status = 'sent'
        GROUP BY bt.id, r.step_kind, r.kind, r.offset_minutes`)
      ).rows as Raw[];

      const perType = (
        await tx.execute(sql`
        SELECT bt.id AS type_id,
               count(DISTINCT a.id) AS total,
               count(DISTINCT a.id) FILTER (WHERE a.customer_confirmed_at IS NOT NULL) AS confirmed,
               count(DISTINCT a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled,
               count(DISTINCT a.id) FILTER (WHERE a.status = 'no_show') AS no_show
        ${FROM} WHERE ${scope} AND r.status = 'sent'
        GROUP BY bt.id`)
      ).rows as Raw[];

      const key = (r: Raw) => `${num(r.type_id)}|${stepOf(r)}`;
      const steps = new Map<string, { typeId: number; step: ReminderReportStep }>();
      for (const r of counts) {
        const k = key(r);
        const have = steps.get(k);
        const base: ReminderReportStep = have?.step ?? {
          stepKind: stepOf(r),
          sent: 0,
          delivered: 0,
          failed: 0,
          skipped: 0,
          fallbackUsed: 0,
          buttons: buttonsIncluded ? { confirmed: 0, rescheduled: 0, cancelled: 0 } : null,
          skippedReasons: {},
          confirmationRate: null,
          cancelRate: null,
          noShowRate: null,
        };
        base.sent += num(r.sent);
        base.delivered += num(r.delivered);
        base.failed += num(r.failed);
        base.skipped += num(r.skipped);
        base.fallbackUsed += num(r.fallback_used);
        if (base.buttons) {
          base.buttons.confirmed += num(r.btn_confirm);
          base.buttons.rescheduled += num(r.btn_reschedule);
          base.buttons.cancelled += num(r.btn_cancel);
        }
        steps.set(k, { typeId: num(r.type_id), step: base });
      }
      for (const r of reasons) {
        const e = steps.get(key(r));
        if (!e) continue;
        const reason = (r.reason as string | null) ?? 'unknown';
        e.step.skippedReasons[reason] = (e.step.skippedReasons[reason] ?? 0) + num(r.n);
      }
      const stepTotals = new Map<
        string,
        { total: number; confirmed: number; cancelled: number; noShow: number }
      >();
      for (const r of outcomes) {
        const t = stepTotals.get(key(r)) ?? { total: 0, confirmed: 0, cancelled: 0, noShow: 0 };
        t.total += num(r.total);
        t.confirmed += num(r.confirmed);
        t.cancelled += num(r.cancelled);
        t.noShow += num(r.no_show);
        stepTotals.set(key(r), t);
      }
      for (const [k, t] of stepTotals) {
        const e = steps.get(k);
        if (!e) continue;
        e.step.confirmationRate = rateOf(t.confirmed, t.total);
        e.step.cancelRate = rateOf(t.cancelled, t.total);
        e.step.noShowRate = rateOf(t.noShow, t.total);
      }

      const types = new Map<number, ReminderReportType>();
      for (const r of counts) {
        const id = num(r.type_id);
        if (types.has(id)) continue;
        const t = perType.find((p) => num(p.type_id) === id);
        types.set(id, {
          bookingTypeId: r.type_uuid as string,
          bookingTypeName: r.type_name as string,
          appointments: num(t?.total),
          confirmationRate: rateOf(num(t?.confirmed), num(t?.total)),
          cancelRate: rateOf(num(t?.cancelled), num(t?.total)),
          noShowRate: rateOf(num(t?.no_show), num(t?.total)),
          steps: [],
        });
      }
      for (const { typeId, step } of steps.values()) types.get(typeId)?.steps.push(step);
      const order: BookingReminderStepKind[] = [
        'confirmation',
        'reminder_24h',
        'reminder_2h',
        'reminder_15m',
        'reminder',
        'after_visit',
        'no_show',
        'rebook',
      ];
      const data = [...types.values()]
        .sort((a, b) => a.bookingTypeName.localeCompare(b.bookingTypeName))
        .map((t) => ({
          ...t,
          steps: t.steps.sort((a, b) => order.indexOf(a.stepKind) - order.indexOf(b.stepKind)),
        }));
      return { from: from.toISOString(), to: to.toISOString(), buttonsIncluded, data };
    });
  }
}
