'use client';

import { useTranslations } from 'next-intl';
import { Field, Input, Select, cn } from '@crm/ui';
import { type BuilderForm } from '../lib/builder-model';
import { Section } from './message-section';

const SCHEDULES = ['now', 'scheduled', 'recurring'] as const;
const REPEATS = ['daily', 'weekly', 'monthly'] as const;

/**
 * Steps 4 and 5 of the builder (TW-CAMP-008, 009): when it goes (now, once later, or on a cadence) in a time zone, the optional
 * end date, and Smart Delivery: a gap range per recipient, batches with a pause, a daily limit and the hours it may send in.
 * Blank means the platform default.
 */
export function DeliverySection({
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
  const num = (key: keyof BuilderForm, label: string, hint?: string, max?: number) => (
    <Field label={label} htmlFor={`camp-${key}`} hint={hint}>
      <Input
        id={`camp-${key}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={form[key] as string}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<BuilderForm>)}
        placeholder={t('default')}
        className="text-[12.5px]"
      />
    </Field>
  );

  return (
    <>
      <Section index="04" title={t('when')}>
        <div role="radiogroup" aria-label={t('when')} className="grid grid-cols-3 gap-2">
          {SCHEDULES.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.scheduleType === k}
              onClick={() => patch({ scheduleType: k })}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-start transition hover:bg-muted',
                form.scheduleType === k ? 'border-brand bg-brand/5' : 'border-border',
              )}
            >
              <div className="text-[12.5px] font-semibold">{t(`schedule.${k}.title`)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {t(`schedule.${k}.hint`)}
              </div>
            </button>
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
              <Input
                id="camp-tz"
                value={form.timezone}
                onChange={(e) => patch({ timezone: e.target.value })}
                placeholder="Asia/Kolkata"
              />
            </Field>
          </div>
        )}

        {form.scheduleType === 'recurring' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('repeat')} htmlFor="camp-repeat">
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

        <Field label={t('expires')} htmlFor="camp-expires" hint={t('expiresHint')}>
          <Input
            id="camp-expires"
            type="datetime-local"
            value={form.expiresAt}
            onChange={(e) => patch({ expiresAt: e.target.value })}
          />
        </Field>
      </Section>

      <Section index="05" title={t('smart')} hint={t('smartHint')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {num('throttleMinSec', t('throttleMin'), t('throttleHint'), 3600)}
          {num('throttleMaxSec', t('throttleMax'), undefined, 3600)}
          {num('batchSize', t('batchSize'), t('batchHint'), 10000)}
          {num('batchPauseMin', t('batchPause'), undefined, 1440)}
          {num('dailyLimit', t('dailyLimit'), t('dailyHint'), 100000)}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t('windowStart')} htmlFor="camp-wstart" hint={t('windowHint')}>
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
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={form.trackingEnabled}
            onChange={(e) => patch({ trackingEnabled: e.target.checked })}
          />
          {t('tracking')}
        </label>
      </Section>
    </>
  );
}
