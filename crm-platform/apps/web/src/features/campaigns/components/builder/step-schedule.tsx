'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Input, Select } from '@crm/ui';
import { timezoneList } from '@/lib/timezones';
import type { BuilderForm } from '../../lib/builder-model';
import { ChoiceCard, StepCard } from './parts';

const SCHEDULES = ['now', 'scheduled', 'recurring'] as const;
const REPEATS = ['weekly', 'daily', 'monthly'] as const;

/**
 * Step 4 (WD-CAMP-008, 009): when it goes (now, once later, on a cadence) in a time zone, the auto-end date, and Smart Delivery: a
 * random gap per recipient, batches with a pause, a daily limit and the hours it may send in. Blank means the platform default.
 */
export function StepSchedule({
  form,
  patch,
  minDate,
}: {
  form: BuilderForm;
  patch: (p: Partial<BuilderForm>) => void;
  minDate: string;
}) {
  const t = useTranslations('campaigns.builder.delivery');
  const later = form.scheduleType !== 'now';
  const zones = useMemo(() => timezoneList(form.timezone), [form.timezone]);
  const num = (key: keyof BuilderForm, label: string, hint: string, max: number, min = 0) => (
    <Field label={label} htmlFor={`camp-${key}`} hint={hint}>
      <Input
        id={`camp-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={form[key] as string}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<BuilderForm>)}
        placeholder={t('default')}
      />
    </Field>
  );

  return (
    <StepCard index="04" title={t('title')} tag={t('queue')}>
      <div
        role="radiogroup"
        aria-label={t('when')}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        {SCHEDULES.map((k) => (
          <ChoiceCard
            key={k}
            compact
            checked={form.scheduleType === k}
            title={t(`schedule.${k}.title`)}
            hint={t(`schedule.${k}.hint`)}
            onSelect={() => patch({ scheduleType: k })}
          />
        ))}
      </div>

      {later && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={`${t('date')} *`} htmlFor="camp-date">
            <Input
              id="camp-date"
              type="date"
              min={minDate}
              value={form.sendDate}
              onChange={(e) => patch({ sendDate: e.target.value })}
            />
          </Field>
          <Field label={`${t('time')} *`} htmlFor="camp-time">
            <Input
              id="camp-time"
              type="time"
              value={form.sendTime}
              onChange={(e) => patch({ sendTime: e.target.value })}
            />
          </Field>
          <Field label={t('timezone')} htmlFor="camp-tz">
            <Select
              id="camp-tz"
              value={form.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Field label={t('expires')} htmlFor="camp-expires" hint={t('expiresHint')}>
        <Input
          id="camp-expires"
          type="datetime-local"
          value={form.expiresAt}
          onChange={(e) => patch({ expiresAt: e.target.value })}
        />
      </Field>

      {form.scheduleType === 'recurring' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('repeat')} htmlFor="camp-repeat" hint={t('repeatHint')}>
            <Select
              id="camp-repeat"
              value={form.repeatInterval}
              onChange={(e) =>
                patch({ repeatInterval: e.target.value as BuilderForm['repeatInterval'] })
              }
            >
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {t(`repeats.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('repeatUntil')} htmlFor="camp-until" hint={t('repeatUntilHint')}>
            <Input
              id="camp-until"
              type="date"
              min={form.sendDate || minDate}
              value={form.repeatUntil}
              onChange={(e) => patch({ repeatUntil: e.target.value })}
            />
          </Field>
        </div>
      )}

      <div className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold">{t('smart')}</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('smartTag')}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {t('smartIntro')} {t('smartZone', { zone: form.timezone })}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {num('throttleMinSec', t('throttleMin'), t('throttleHint'), 3600)}
          {num('throttleMaxSec', t('throttleMax'), t('throttleMaxHint'), 3600)}
          {num('dailyLimit', t('dailyLimit'), t('dailyHint'), 100000, 1)}
          {num('batchSize', t('batchSize'), t('batchHint'), 10000, 1)}
          {num('batchPauseMin', t('batchPause'), t('batchPauseHint'), 1440)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={t('windowStart')} htmlFor="camp-wstart">
            <Input
              id="camp-wstart"
              type="time"
              value={form.windowStart}
              onChange={(e) => patch({ windowStart: e.target.value })}
            />
          </Field>
          <Field label={t('windowEnd')} htmlFor="camp-wend">
            <Input
              id="camp-wend"
              type="time"
              value={form.windowEnd}
              onChange={(e) => patch({ windowEnd: e.target.value })}
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('windowHint', { zone: form.timezone })}
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          checked={form.trackingEnabled}
          onChange={(e) => patch({ trackingEnabled: e.target.checked })}
        />
        {t('tracking')}
      </label>
    </StepCard>
  );
}
