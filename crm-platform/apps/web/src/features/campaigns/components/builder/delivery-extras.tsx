'use client';

import { useTranslations } from 'next-intl';
import { Field, Input } from '@crm/ui';

export const PACING_KEYS = [
  'throttleMinSec',
  'throttleMaxSec',
  'dailyLimit',
  'batchSize',
  'batchPauseMin',
  'windowStart',
  'windowEnd',
] as const;
export type PacingKey = (typeof PACING_KEYS)[number];

/** The hard end date of a send (`datetime-local`), blank for the platform default. */
export function AutoEndField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('campaigns.builder.delivery');
  return (
    <Field label={t('expires')} htmlFor="camp-expires" hint={t('expiresHint')} error={error}>
      <Input
        id="camp-expires"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * Smart Delivery: a random gap per recipient, batches with a pause, a daily limit and the hours it may send in, read in `zone`. Blank
 * means the platform default. Shared by the classic builder and the guided flow.
 */
export function SmartDelivery({
  zone,
  values,
  onChange,
  error,
}: {
  zone: string;
  values: Record<PacingKey, string>;
  onChange: (key: PacingKey, value: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('campaigns.builder.delivery');
  const num = (key: PacingKey, label: string, hint: string, max: number, min = 0) => (
    <Field label={label} htmlFor={`camp-${key}`} hint={hint}>
      <Input
        id={`camp-${key}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={values[key]}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={t('default')}
      />
    </Field>
  );
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{t('smart')}</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t('smartTag')}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {t('smartIntro')} {t('smartZone', { zone })}
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
            value={values.windowStart}
            onChange={(e) => onChange('windowStart', e.target.value)}
          />
        </Field>
        <Field label={t('windowEnd')} htmlFor="camp-wend">
          <Input
            id="camp-wend"
            type="time"
            value={values.windowEnd}
            onChange={(e) => onChange('windowEnd', e.target.value)}
          />
        </Field>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{t('windowHint', { zone })}</p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Track link clicks". */
export function TrackClicks({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('campaigns.builder.delivery');
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {t('tracking')}
    </label>
  );
}

/** "Retry failed messages automatically": a temporary failure is tried again under the platform's retry settings; off, the first failure is final. */
export function RetryFailed({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations('campaigns.builder.delivery');
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {t('retryFailed')}
        <span className="block text-xs text-muted-foreground">{t('retryFailedHint')}</span>
      </span>
    </label>
  );
}
