'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import {
  clockLabel,
  dateLabel,
  dialPoint,
  dialValue,
  formatClock,
  isoOf,
  monthGrid,
  parseClock,
  shiftMonth,
  type ClockTime,
} from '../lib/pickers';

/** A modal sheet on the native <dialog>: Esc and a click outside close it, focus stays inside while it is open. */
function Sheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40"
    >
      {open && children}
    </dialog>
  );
}

const TRIGGER =
  'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger';

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 9h18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/** A date field that opens a month calendar. `value` and `min` are YYYY-MM-DD. */
export function DatePicker({
  id,
  value,
  min,
  disabled,
  invalid,
  onChange,
}: {
  id?: string;
  value: string;
  min?: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (iso: string) => void;
}) {
  const t = useTranslations('campaigns.wizard.pickers');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const seed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (min ?? isoOf(2026, 0, 1));
  const [view, setView] = useState({
    year: Number(seed.slice(0, 4)),
    month0: Number(seed.slice(5, 7)) - 1,
  });
  const [picked, setPicked] = useState(value);
  const weeks = useMemo(() => monthGrid(view.year, view.month0), [view]);
  const monthName = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.year, view.month0, 1)));
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 0, 4 + d)),
    ),
  );
  const openIt = () => {
    const s = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (min ?? seed);
    setView({ year: Number(s.slice(0, 4)), month0: Number(s.slice(5, 7)) - 1 });
    setPicked(value);
    setOpen(true);
  };
  return (
    <>
      <button
        id={id}
        type="button"
        data-picker="date"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        onClick={openIt}
        className={TRIGGER}
      >
        <span className={value ? '' : 'text-muted-foreground'}>
          {value ? dateLabel(value) : t('datePlaceholder')}
        </span>
        <CalendarIcon />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label={t('selectDate')}>
        <div className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('selectDate')}</p>
          <p className="mt-1 text-2xl font-semibold" data-testid="picked-date">
            {picked ? dateLabel(picked) : '--/--/----'}
          </p>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              aria-label={t('prevMonth')}
              className="grid size-8 place-items-center rounded-full hover:bg-muted"
              onClick={() => setView(shiftMonth(view.year, view.month0, -1))}
            >
              ‹
            </button>
            <span className="text-sm font-medium capitalize">{monthName}</span>
            <button
              type="button"
              aria-label={t('nextMonth')}
              className="grid size-8 place-items-center rounded-full hover:bg-muted"
              onClick={() => setView(shiftMonth(view.year, view.month0, 1))}
            >
              ›
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-xs text-muted-foreground">
            {dayNames.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1">
            {weeks.flat().map((d) => {
              const off = min !== undefined && d.iso < min;
              const on = d.iso === picked;
              return (
                <button
                  key={d.iso}
                  type="button"
                  disabled={off}
                  aria-pressed={on}
                  aria-label={dateLabel(d.iso)}
                  onClick={() => setPicked(d.iso)}
                  className={cn(
                    'mx-auto grid size-9 place-items-center rounded-full text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    d.inMonth ? '' : 'text-muted-foreground/50',
                    on ? 'bg-brand font-semibold text-brand-foreground' : 'hover:bg-muted',
                    off && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                  )}
                >
                  {d.day}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2 text-sm font-semibold uppercase">
            <button
              type="button"
              className="rounded px-3 py-2 text-brand hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={!picked}
              className="rounded px-3 py-2 text-brand hover:bg-muted disabled:opacity-40"
              onClick={() => {
                onChange(picked);
                setOpen(false);
              }}
            >
              {t('ok')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

const DIAL = 220;

/** A time field that opens a clock: pick the hour, then the minute, AM or PM. `value` is HH:MM (24 hours). */
export function TimePicker({
  id,
  value,
  disabled,
  invalid,
  onChange,
}: {
  id?: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (time: string) => void;
}) {
  const t = useTranslations('campaigns.wizard.pickers');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ClockTime>(() => parseClock(value));
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const marks = mode === 'hour' ? 12 : 60;
  const current = mode === 'hour' ? draft.hour % 12 : draft.minute;
  const hand = dialPoint(current, marks, 40);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const openIt = () => {
    setDraft(parseClock(value));
    setMode('hour');
    setOpen(true);
  };
  const pick = (v: number) => {
    if (mode === 'hour') {
      setDraft((d) => ({ ...d, hour: v === 0 ? 12 : v }));
      setMode('minute');
    } else {
      setDraft((d) => ({ ...d, minute: v }));
    }
  };
  return (
    <>
      <button
        id={id}
        type="button"
        data-picker="time"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-haspopup="dialog"
        onClick={openIt}
        className={TRIGGER}
      >
        <span>{clockLabel(value)}</span>
        <ClockIcon />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label={t('selectTime')}>
        <div className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('selectTime')}</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-baseline text-5xl font-light" data-testid="picked-time">
              <button
                type="button"
                aria-label={t('hour')}
                aria-pressed={mode === 'hour'}
                className={mode === 'hour' ? '' : 'text-muted-foreground'}
                onClick={() => setMode('hour')}
              >
                {pad2(draft.hour)}
              </button>
              <span className="px-0.5 text-muted-foreground">:</span>
              <button
                type="button"
                aria-label={t('minute')}
                aria-pressed={mode === 'minute'}
                className={mode === 'minute' ? '' : 'text-muted-foreground'}
                onClick={() => setMode('minute')}
              >
                {pad2(draft.minute)}
              </button>
            </div>
            <div className="flex flex-col text-sm font-semibold">
              {([false, true] as const).map((pm) => (
                <button
                  key={String(pm)}
                  type="button"
                  aria-pressed={draft.pm === pm}
                  className={draft.pm === pm ? '' : 'text-muted-foreground'}
                  onClick={() => setDraft((d) => ({ ...d, pm }))}
                >
                  {pm ? t('pm') : t('am')}
                </button>
              ))}
            </div>
          </div>
          <div
            role="group"
            aria-label={mode === 'hour' ? t('hour') : t('minute')}
            data-testid="clock-face"
            className="relative mx-auto mt-4 cursor-pointer touch-none select-none rounded-full bg-muted"
            style={{ width: DIAL, height: DIAL }}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              pick(
                dialValue(
                  e.clientX - (r.left + r.width / 2),
                  e.clientY - (r.top + r.height / 2),
                  marks,
                ),
              );
            }}
          >
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
            />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-0.5 origin-left bg-brand"
              style={{
                width: `${Math.hypot(hand.x, hand.y)}%`,
                transform: `rotate(${(current / marks) * 360 - 90}deg)`,
              }}
            />
            {Array.from({ length: mode === 'hour' ? 12 : 12 }, (_, i) => {
              const v = mode === 'hour' ? (i === 0 ? 12 : i) : i * 5;
              const idx = mode === 'hour' ? i : i * 5;
              const p = dialPoint(idx, marks, 40);
              const on = mode === 'hour' ? v === draft.hour : idx === draft.minute;
              return (
                <button
                  key={`${mode}-${v}`}
                  type="button"
                  tabIndex={-1}
                  aria-label={mode === 'hour' ? String(v) : pad2(v)}
                  className={cn(
                    'pointer-events-none absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-sm',
                    on && 'bg-brand font-semibold text-brand-foreground',
                  )}
                  style={{ left: `${50 + p.x}%`, top: `${50 + p.y}%` }}
                >
                  {mode === 'hour' ? v : pad2(v)}
                </button>
              );
            })}
            {mode === 'minute' && draft.minute % 5 !== 0 && (
              <span
                aria-hidden="true"
                className="absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-foreground"
                style={{ left: `${50 + hand.x}%`, top: `${50 + hand.y}%` }}
              >
                {pad2(draft.minute)}
              </span>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2 text-sm font-semibold uppercase">
            <button
              type="button"
              className="rounded px-3 py-2 text-brand hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="rounded px-3 py-2 text-brand hover:bg-muted"
              onClick={() => {
                onChange(formatClock(draft));
                setOpen(false);
              }}
            >
              {t('ok')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
