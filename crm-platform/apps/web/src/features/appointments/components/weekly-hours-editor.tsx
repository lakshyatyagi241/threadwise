'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button, Menu, MenuItem, Switch, cn } from '@crm/ui';
import {
  addInterval,
  copyDay,
  dayMinutes,
  dayProblems,
  MAX_INTERVALS_PER_DAY,
  WEEKDAYS,
  type Interval,
  type Weekday,
  type WeeklyHours,
} from '../lib/availability';
import { weekdayLabel } from '../lib/format';
import { CopyIcon, MinusIcon, PlusIcon } from './icons';

export interface WeeklyHoursEditorProps {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
  disabled?: boolean;
  /** Draws a problem line under a row. Defaults to on. */
  showProblems?: boolean;
  className?: string;
}

const timeInput =
  'h-9 w-[7.25rem] rounded-md border border-border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';

/**
 * A booking type's (or the workspace's) weekly hours: one row per weekday, Monday first. A day is open when it has at least
 * one interval; the switch opens a day with 09:00 to 17:00 and closes it by removing its intervals. Each day can hold several
 * intervals (a lunch break), and its hours can be copied onto other days. The model and its rules live in `lib/availability`.
 */
export function WeeklyHoursEditor({
  value,
  onChange,
  disabled,
  showProblems = true,
  className,
}: WeeklyHoursEditorProps) {
  const t = useTranslations('appointments.hours');
  const locale = useLocale();

  const setDay = (d: Weekday, list: Interval[]) => onChange({ ...value, [d]: list });
  const setRow = (d: Weekday, id: string, patch: Partial<Interval>) =>
    setDay(
      d,
      value[d].map((iv) => (iv.id === id ? { ...iv, ...patch } : iv)),
    );

  return (
    <div className={cn('divide-y divide-border rounded-xl border border-border', className)}>
      {WEEKDAYS.map((d) => {
        const list = value[d];
        const open = list.length > 0;
        const problems = dayProblems(list);
        const mins = dayMinutes(list);
        const name = weekdayLabel(d, locale, 'long');
        return (
          <div key={d} className="grid gap-2 px-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
            <div className="flex items-center gap-3 sm:items-start sm:pt-1.5">
              <Switch
                checked={open}
                disabled={disabled}
                label={t('openDay', { day: name })}
                onCheckedChange={(on) => setDay(d, on ? addInterval([]) : [])}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">
                  {open
                    ? t('daySummary', { hours: Math.floor(mins / 60), minutes: mins % 60 })
                    : t('closed')}
                </div>
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              {list.map((iv, i) => {
                const problem = problems.get(iv.id);
                return (
                  <div key={iv.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={iv.from}
                        disabled={disabled}
                        aria-label={t('from', { day: name, n: i + 1 })}
                        aria-invalid={problem ? true : undefined}
                        onChange={(e) => setRow(d, iv.id, { from: e.target.value })}
                        className={cn(timeInput, problem && 'border-danger')}
                      />
                      <span aria-hidden="true" className="text-muted-foreground">
                        –
                      </span>
                      <input
                        type="time"
                        value={iv.to}
                        disabled={disabled}
                        aria-label={t('to', { day: name, n: i + 1 })}
                        aria-invalid={problem ? true : undefined}
                        onChange={(e) => setRow(d, iv.id, { to: e.target.value })}
                        className={cn(timeInput, problem && 'border-danger')}
                      />
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          setDay(
                            d,
                            list.filter((x) => x.id !== iv.id),
                          )
                        }
                        aria-label={t('removeInterval', { day: name, n: i + 1 })}
                        title={t('removeInterval', { day: name, n: i + 1 })}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                      >
                        <MinusIcon />
                      </button>
                    </div>
                    {showProblems && problem && (
                      <p role="alert" className="mt-1 text-xs text-danger">
                        {t(`problems.${problem}`)}
                      </p>
                    )}
                  </div>
                );
              })}
              {open && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || list.length >= MAX_INTERVALS_PER_DAY}
                    onClick={() => setDay(d, addInterval(list))}
                  >
                    <PlusIcon /> {t('addInterval')}
                  </Button>
                  <Menu
                    label={t('copyTo', { day: name })}
                    align="start"
                    disabled={disabled}
                    triggerClassName="h-8 border-transparent px-3 text-sm hover:bg-muted"
                    trigger={
                      <>
                        <CopyIcon /> {t('copyDay')}
                      </>
                    }
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          onSelect={() => {
                            close();
                            onChange(
                              copyDay(
                                value,
                                d,
                                WEEKDAYS.filter((x) => x >= 1 && x <= 5),
                              ),
                            );
                          }}
                        >
                          {t('copyWeekdays')}
                        </MenuItem>
                        <MenuItem
                          onSelect={() => {
                            close();
                            onChange(copyDay(value, d, WEEKDAYS));
                          }}
                        >
                          {t('copyAll')}
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
