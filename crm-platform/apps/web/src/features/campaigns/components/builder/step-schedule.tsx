'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Input, Select } from '@crm/ui';
import { timezoneList } from '@/lib/timezones';
import type { BuilderForm } from '../../lib/builder-model';
import { AutoEndField, SmartDelivery, TrackClicks } from './delivery-extras';
import { ChoiceCard, StepCard } from './parts';

const SCHEDULES = ['now', 'scheduled', 'recurring'] as const;
const REPEATS = ['weekly', 'daily', 'monthly'] as const;

/**
 * Step 4 (TW-CAMP-008, 009): when it goes (now, once later, on a cadence) in a time zone, the auto-end date, and Smart Delivery: a
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

      <AutoEndField value={form.expiresAt} onChange={(expiresAt) => patch({ expiresAt })} />

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

      <SmartDelivery
        zone={form.timezone}
        values={form}
        onChange={(key, value) => patch({ [key]: value } as Partial<BuilderForm>)}
      />

      <TrackClicks
        checked={form.trackingEnabled}
        onChange={(trackingEnabled) => patch({ trackingEnabled })}
      />
    </StepCard>
  );
}
