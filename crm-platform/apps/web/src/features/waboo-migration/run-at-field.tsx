'use client';

import { useId, useMemo } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Field, Input } from '@crm/ui';
import { localToIso, operatorTimeZone, runAtProblem } from './lib/run-at';

/** Optional "Run at": a local date and time, with the operator's timezone and the same instant in UTC printed under it. */
export function RunAtField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('waboo-migration.schedule');
  const format = useFormatter();
  const id = useId();
  const tz = useMemo(() => operatorTimeZone(), []);
  const problem = runAtProblem(value, new Date());
  const iso = localToIso(value);
  const utc = iso
    ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    : null;
  return (
    <Field
      label={t('label')}
      htmlFor={id}
      hint={utc ? t('utc', { tz, utc }) : t('hint', { tz })}
      error={problem ? t(`error.${problem}`) : undefined}
    >
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        invalid={Boolean(problem)}
      />
    </Field>
  );
}
