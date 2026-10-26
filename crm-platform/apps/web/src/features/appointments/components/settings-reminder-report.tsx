'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ReminderReportStep, ReminderReportType } from '@crm/contracts';
import { Button, Select, Spinner } from '@crm/ui';
import { useBookingTypes, useReminderReport } from '../api/hooks';
import {
  customWindow,
  percentOf,
  presetWindow,
  reasonsOf,
  reportIsEmpty,
  totalsOf,
  visibleTypes,
  type ReportRange,
} from '../lib/reminder-report';
import { ErrorLine } from './parts';
import { UpgradeHint } from './reminder-step-parts';
import { SettingsCard } from './settings-parts';

const RANGE_DAYS: Record<Exclude<ReportRange, 'custom'>, number> = { '7': 7, '30': 30, '90': 90 };
const NUM = 'px-2 py-1.5 text-end tabular-nums';
const HEAD = 'px-2 py-1.5 text-end font-medium';

/**
 * "What the reminders did" (BL-429): per booking type and step, how many were sent, delivered, failed, skipped (and why) and how many
 * went by the next channel, with the Confirm / Reschedule / Cancel taps when the plan has the buttons. Read-only; the numbers are counts,
 * never a contact, address or message.
 */
export function ReminderReportSection() {
  const t = useTranslations('appointments.reminders.report');
  const types = useBookingTypes();
  const [typeId, setTypeId] = useState('');
  const [range, setRange] = useState<ReportRange>('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // The window is fixed when the choice changes (or Refresh is pressed): a window that moved with every render would never cache.
  const [stamp, setStamp] = useState(0);
  const custom = useMemo(() => customWindow(from, to), [from, to]);
  const win = useMemo(
    () => (range === 'custom' ? custom : presetWindow(RANGE_DAYS[range])),
    // `stamp` is the Refresh button: it moves the window's end to now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, custom, stamp],
  );
  const report = useReminderReport({
    ...(typeId ? { bookingTypeId: typeId } : {}),
    ...(win ?? {}),
  });
  const waitingForDates = range === 'custom' && !custom;

  return (
    <SettingsCard id="reminder-report" title={t('title')} description={t('description')}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium">
          <span>{t('type')}</span>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {(types.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>{t('range')}</span>
          <Select value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
            <option value="7">{t('ranges.7')}</option>
            <option value="30">{t('ranges.30')}</option>
            <option value="90">{t('ranges.90')}</option>
            <option value="custom">{t('ranges.custom')}</option>
          </Select>
        </label>
        {range === 'custom' && (
          <>
            <label className="space-y-1 text-xs font-medium">
              <span>{t('from')}</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="block h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-xs font-medium">
              <span>{t('to')}</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="block h-9 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={waitingForDates}
          onClick={() => {
            setStamp((n) => n + 1);
            void report.refetch();
          }}
        >
          {t('refresh')}
        </Button>
      </div>

      {waitingForDates ? (
        <p className="text-sm text-muted-foreground">{t('pickDates')}</p>
      ) : report.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : report.isError ? (
        <ErrorLine error={report.error} onRetry={() => void report.refetch()} />
      ) : reportIsEmpty(report.data) ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <>
          <ul className="space-y-5">
            {visibleTypes(report.data).map((type) => (
              <li key={type.bookingTypeId}>
                <TypeTable type={type} buttons={report.data.buttonsIncluded} />
              </li>
            ))}
          </ul>
          {!report.data.buttonsIncluded && <UpgradeHint>{t('buttonsLocked')}</UpgradeHint>}
          <p className="text-xs text-muted-foreground">{t('emailNote')}</p>
        </>
      )}
    </SettingsCard>
  );
}

function RateLine({ type }: { type: ReminderReportType }) {
  const t = useTranslations('appointments.reminders.report');
  const c = percentOf(type.confirmationRate);
  const x = percentOf(type.cancelRate);
  const n = percentOf(type.noShowRate);
  if (c === null && x === null && n === null) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t('rates', {
        count: type.appointments,
        confirmed: c ?? 0,
        cancelled: x ?? 0,
        noShow: n ?? 0,
      })}
    </p>
  );
}

function TypeTable({ type, buttons }: { type: ReminderReportType; buttons: boolean }) {
  const t = useTranslations('appointments.reminders.report');
  const tl = useTranslations('appointments.reminders.timeline.step');
  const total = totalsOf(type.steps);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{type.bookingTypeName}</h3>
      <RateLine type={type} />
      <div className="thin-scrollbar overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t('caption', { name: type.bookingTypeName })}</caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-1.5 text-start font-medium">
                {t('col.step')}
              </th>
              <th scope="col" className={HEAD}>
                {t('col.sent')}
              </th>
              <th scope="col" className={HEAD}>
                {t('col.delivered')}
              </th>
              <th scope="col" className={HEAD}>
                {t('col.failed')}
              </th>
              <th scope="col" className={HEAD}>
                {t('col.fallback')}
              </th>
              <th scope="col" className={HEAD}>
                {t('col.skipped')}
              </th>
              {buttons && (
                <>
                  <th scope="col" className={HEAD}>
                    {t('col.confirmed')}
                  </th>
                  <th scope="col" className={HEAD}>
                    {t('col.rescheduled')}
                  </th>
                  <th scope="col" className={HEAD}>
                    {t('col.cancelled')}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {type.steps.map((s) => (
              <StepRow key={s.stepKind} step={s} label={tl(s.stepKind)} buttons={buttons} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-medium">
              <th scope="row" className="px-2 py-1.5 text-start">
                {t('col.total')}
              </th>
              <td className={NUM}>{total.sent}</td>
              <td className={NUM}>{total.delivered}</td>
              <td className={NUM}>{total.failed}</td>
              <td className={NUM}>{total.fallbackUsed}</td>
              <td className={NUM}>{total.skipped}</td>
              {buttons && (
                <>
                  <td className={NUM}>{total.buttons?.confirmed ?? 0}</td>
                  <td className={NUM}>{total.buttons?.rescheduled ?? 0}</td>
                  <td className={NUM}>{total.buttons?.cancelled ?? 0}</td>
                </>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function StepRow({
  step,
  label,
  buttons,
}: {
  step: ReminderReportStep;
  label: string;
  buttons: boolean;
}) {
  const t = useTranslations('appointments.reminders.report');
  const tr = useTranslations('appointments.reminders.reasons');
  const reasons = reasonsOf(step);
  return (
    <tr className="border-b border-border/60 align-top">
      <th scope="row" className="px-2 py-1.5 text-start font-normal">
        {label}
      </th>
      <td className={NUM}>{step.sent}</td>
      <td className={NUM}>{step.delivered}</td>
      <td className={NUM}>{step.failed}</td>
      <td className={NUM}>{step.fallbackUsed}</td>
      <td className={NUM}>
        {step.skipped}
        {reasons.length > 0 && (
          <details className="text-start text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t('why')}</summary>
            <ul className="mt-1 space-y-0.5">
              {reasons.map((r) => (
                <li key={r.reason}>
                  {tr.has(r.reason) ? tr(r.reason) : t('otherReason')}: {r.count}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      {buttons && (
        <>
          <td className={NUM}>{step.buttons?.confirmed ?? 0}</td>
          <td className={NUM}>{step.buttons?.rescheduled ?? 0}</td>
          <td className={NUM}>{step.buttons?.cancelled ?? 0}</td>
        </>
      )}
    </tr>
  );
}
