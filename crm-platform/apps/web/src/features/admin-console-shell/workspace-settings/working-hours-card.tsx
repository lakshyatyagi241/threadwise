'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BUSINESS_HOURS_DAY_KEYS, type BusinessHours, type BusinessHoursDay } from '@crm/contracts';
import { Alert, Button, Card, Checkbox, Field, Input, Spinner, Switch } from '@crm/ui';
import { useSaveWorkingHours, useWorkingHours } from './api';
import {
  MAX_HOLIDAYS,
  MAX_WINDOWS,
  addHoliday,
  addWindow,
  checkDraft,
  copyMondayToWeekdays,
  draftFrom,
  hasProblems,
  isAllDay,
  isOvernight,
  removeWindow,
  setAllDay,
  toRequest,
  type DayDraft,
  type Problems,
  type WorkingHoursDraft,
} from './working-hours';

const NS = 'admin-console-shell.workspaceSettings.general.hours';

/**
 * TW-ASHELL-034: the workspace's working hours. Reference's card was static markup that saved nothing; here it is the real business
 * hours (the schedule the inbox routing rules, SLA timers, flows and lead replies read), edited by the workspace owner in the time zone
 * set above. Per day: on or off, up to three windows, an overnight window when the closing time is before the opening time, or open
 * all day. Holidays are dates the workspace is closed all day.
 */
export function WorkingHoursCard() {
  const t = useTranslations(NS);
  const q = useWorkingHours();
  if (q.isPending) {
    return (
      <Card className="flex justify-center p-6">
        <Spinner />
      </Card>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Card className="p-6">
        <Alert tone="danger">{t('loadFailed')}</Alert>
      </Card>
    );
  }
  // A fresh form whenever the saved hours change.
  return <HoursForm key={JSON.stringify(q.data)} hours={q.data} />;
}

function HoursForm({ hours }: { hours: BusinessHours }) {
  const t = useTranslations(NS);
  const save = useSaveWorkingHours();
  const [draft, setDraft] = useState<WorkingHoursDraft>(() => draftFrom(hours));
  const [problems, setProblems] = useState<Problems>({ days: {}, holidays: {} });
  const [saved, setSaved] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const locked = !hours.canEditTimezone;
  const edit = (next: WorkingHoursDraft) => {
    setSaved(false);
    setDraft(next);
  };
  const setDay = (k: BusinessHoursDay, day: DayDraft) =>
    edit({ ...draft, days: { ...draft.days, [k]: day } });

  return (
    <Card className="space-y-4 p-6">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (locked) return;
          setSaved(false);
          const found = checkDraft(draft);
          setProblems(found);
          if (hasProblems(found)) return;
          save.mutate(toRequest(draft), { onSuccess: () => setSaved(true) });
        }}
      >
        <div className="space-y-1">
          <h2 className="font-serif text-xl">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('note', { timezone: hours.timezone })}</p>
          {locked && <p className="text-xs italic text-muted-foreground">{t('ownerOnly')}</p>}
        </div>
        {saved && <Alert tone="success">{t('saved')}</Alert>}
        {save.isError && <Alert tone="danger">{t('saveFailed')}</Alert>}

        <fieldset className="space-y-3" disabled={locked || save.isPending}>
          <legend className="sr-only">{t('title')}</legend>
          {BUSINESS_HOURS_DAY_KEYS.map((k) => {
            const day = draft.days[k];
            const problem = problems.days[k];
            const dayName = t(`day.${k}`);
            const allDay = isAllDay(day);
            return (
              <div
                key={k}
                className="grid items-start gap-3 sm:grid-cols-[130px_60px_1fr]"
                data-testid={`wh-${k}`}
              >
                <span className="pt-2 text-sm font-medium">{dayName}</span>
                <div className="pt-1.5">
                  <Switch
                    checked={day.enabled}
                    onCheckedChange={(on) => setDay(k, { ...day, enabled: on })}
                    label={dayName}
                  />
                </div>
                <div className="space-y-2">
                  {!day.enabled ? (
                    <p className="pt-2 text-sm text-muted-foreground">{t('closed')}</p>
                  ) : (
                    <>
                      {allDay ? (
                        <p className="pt-2 text-sm">{t('openAllDay')}</p>
                      ) : (
                        day.windows.map((w, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2">
                            <Input
                              type="time"
                              className="w-32"
                              value={w.from}
                              aria-label={`${dayName} ${t('from')}`}
                              aria-invalid={problem ? true : undefined}
                              onChange={(e) =>
                                setDay(k, {
                                  ...day,
                                  windows: day.windows.map((x, j) =>
                                    j === i ? { ...x, from: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <span className="text-muted-foreground" aria-hidden>
                              –
                            </span>
                            <Input
                              type="time"
                              className="w-32"
                              value={w.to}
                              aria-label={`${dayName} ${t('to')}`}
                              aria-invalid={problem ? true : undefined}
                              onChange={(e) =>
                                setDay(k, {
                                  ...day,
                                  windows: day.windows.map((x, j) =>
                                    j === i ? { ...x, to: e.target.value } : x,
                                  ),
                                })
                              }
                            />
                            {isOvernight(w) && (
                              <span className="text-xs text-muted-foreground">
                                {t('overnight')}
                              </span>
                            )}
                            {day.windows.length > 1 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setDay(k, removeWindow(day, i))}
                                aria-label={t('removeWindow', { day: dayName })}
                              >
                                {t('remove')}
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Checkbox
                          id={`wh-${k}-allday`}
                          label={t('allDay')}
                          checked={allDay}
                          onChange={(e) => setDay(k, setAllDay(day, e.target.checked))}
                        />
                        {!allDay && day.windows.length < MAX_WINDOWS && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setDay(k, addWindow(day))}
                          >
                            {t('addWindow')}
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  {problem && (
                    <p className="text-xs text-danger" role="alert">
                      {t(`problem.${problem}`)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => edit(copyMondayToWeekdays(draft))}
          >
            {t('copyMonday')}
          </Button>
        </fieldset>

        <fieldset
          className="space-y-3 border-t border-border pt-4"
          disabled={locked || save.isPending}
        >
          <legend className="text-sm font-semibold">{t('holidays.title')}</legend>
          <p className="text-xs text-muted-foreground">{t('holidays.note')}</p>
          {draft.holidays.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('holidays.none')}</p>
          )}
          <ul className="space-y-1">
            {draft.holidays.map((h, i) => (
              <li key={`${h.date}-${i}`} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono">{h.date}</span>
                <span className="text-muted-foreground">{h.label}</span>
                {problems.holidays[i] && (
                  <span className="text-xs text-danger" role="alert">
                    {t(`holidays.problem.${problems.holidays[i]}`)}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('holidays.removeFor', { date: h.date })}
                  onClick={() =>
                    edit({ ...draft, holidays: draft.holidays.filter((_, j) => j !== i) })
                  }
                >
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
          {draft.holidays.length < MAX_HOLIDAYS && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('holidays.date')} htmlFor="wh-holiday-date">
                <Input
                  id="wh-holiday-date"
                  type="date"
                  className="w-44"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </Field>
              <Field label={t('holidays.label')} htmlFor="wh-holiday-label">
                <Input
                  id="wh-holiday-label"
                  value={newLabel}
                  maxLength={80}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                disabled={newDate === ''}
                onClick={() => {
                  edit(addHoliday(draft, newDate, newLabel));
                  setNewDate('');
                  setNewLabel('');
                }}
              >
                {t('holidays.add')}
              </Button>
            </div>
          )}
        </fieldset>

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" disabled={locked || save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
