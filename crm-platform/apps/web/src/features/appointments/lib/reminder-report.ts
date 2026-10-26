import type { ReminderReport, ReminderReportStep, ReminderReportType } from '@crm/contracts';

/**
 * The delivery report of the reminder sequences (BL-429). No React in here: the date window, the numbers shown and the empty rule.
 * The API counts steps by their due time; email has no delivery report from the provider, so "delivered" is a WhatsApp figure.
 */

export const REPORT_RANGES = ['7', '30', '90', 'custom'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

const DAY = 86_400_000;

/** The window for a preset, ending now. */
export function presetWindow(days: number, now: Date = new Date()): { from: string; to: string } {
  return { from: new Date(now.getTime() - days * DAY).toISOString(), to: now.toISOString() };
}

/**
 * The window for two `YYYY-MM-DD` dates typed by the owner: from the start of the first day to the end of the second (the API's `to` is
 * exclusive). Null while a date is missing, backwards, or the span is longer than a year.
 */
export function customWindow(from: string, to: string): { from: string; to: string } | null {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  if ((b - a) / DAY > 366) return null;
  return { from: new Date(a).toISOString(), to: new Date(b + DAY).toISOString() };
}

/** A rate as a whole percent, or null when there is nothing to divide by. */
export function percentOf(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100);
}

/** What a step did, summed over the steps of several booking types (the totals row). */
export interface StepTotals {
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
  fallbackUsed: number;
  buttons: { confirmed: number; rescheduled: number; cancelled: number } | null;
}

export function totalsOf(steps: readonly ReminderReportStep[]): StepTotals {
  const out: StepTotals = {
    sent: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
    fallbackUsed: 0,
    buttons: null,
  };
  for (const s of steps) {
    out.sent += s.sent;
    out.delivered += s.delivered;
    out.failed += s.failed;
    out.skipped += s.skipped;
    out.fallbackUsed += s.fallbackUsed;
    if (s.buttons) {
      out.buttons ??= { confirmed: 0, rescheduled: 0, cancelled: 0 };
      out.buttons.confirmed += s.buttons.confirmed;
      out.buttons.rescheduled += s.buttons.rescheduled;
      out.buttons.cancelled += s.buttons.cancelled;
    }
  }
  return out;
}

/** True when no step of any booking type has a single record in the window (the "nothing sent yet" state). */
export function reportIsEmpty(report: ReminderReport): boolean {
  return report.data.every((t) => t.steps.every((s) => s.sent + s.failed + s.skipped === 0));
}

/** The booking types that have something to show, with the steps that have any record. */
export function visibleTypes(report: ReminderReport): ReminderReportType[] {
  return report.data
    .map((t) => ({ ...t, steps: t.steps.filter((s) => s.sent + s.failed + s.skipped > 0) }))
    .filter((t) => t.steps.length > 0);
}

/** The skip reasons of a step, the most frequent first. */
export function reasonsOf(step: ReminderReportStep): Array<{ reason: string; count: number }> {
  return Object.entries(step.skippedReasons)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
