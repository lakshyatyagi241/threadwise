'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Field, Input, Select } from '@crm/ui';
import { isValidZone, offsetLabel, zonesWith } from '../lib/zone';
import { SectionCard, TextField, useEditor } from './editor-shared';
import { GlobeIcon } from './icons';

const MAX_OPTIONS = 600;

/** Step 2: how long a booking runs, the gaps around it, how far ahead and how soon people may book, and the time zone. */
export function TimingStep() {
  const t = useTranslations('appointments.editor.timing');
  const { draft, set, err, fid, disabled } = useEditor();
  const [query, setQuery] = useState('');
  const [now] = useState(() => Date.now());

  const zones = useMemo(() => {
    const q = query.trim().toLowerCase().replaceAll('_', ' ');
    const all = zonesWith(draft.timezone);
    const hits = q
      ? all.filter(
          (z) =>
            z.toLowerCase().replaceAll('_', ' ').includes(q) ||
            offsetLabel(now, z).toLowerCase().includes(q),
        )
      : all;
    // the chosen zone always stays in the list, so the select never shows an empty box
    const list =
      hits.includes(draft.timezone) || !isValidZone(draft.timezone)
        ? hits
        : [draft.timezone, ...hits];
    return { list, matched: hits.length };
  }, [query, draft.timezone, now]);

  const zoneError = err('timezone');

  return (
    <div className="space-y-4">
      <SectionCard title={t('title')} hint={t('hint')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField name="duration" numeric label={t('duration')} hint={t('durationHint')} />
          <TextField name="increment" numeric label={t('increment')} hint={t('incrementHint')} />
          <TextField name="capacity" numeric label={t('capacity')} hint={t('capacityHint')} />
          <TextField name="bufferBefore" numeric label={t('bufferBefore')} hint={t('bufferHint')} />
          <TextField name="bufferAfter" numeric label={t('bufferAfter')} hint={t('bufferHint')} />
          <TextField name="minNotice" numeric label={t('minNotice')} hint={t('minNoticeHint')} />
          <TextField name="maxAdvance" numeric label={t('maxAdvance')} hint={t('maxAdvanceHint')} />
          <TextField
            name="maxPerDay"
            numeric
            label={t('maxPerDay')}
            hint={t('maxPerDayHint')}
            placeholder={t('noLimit')}
          />
        </div>
      </SectionCard>

      <SectionCard title={t('zoneTitle')} hint={t('zoneHint')}>
        <Field label={t('zone')} htmlFor={fid('timezone')} error={zoneError}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div className="relative">
              <GlobeIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                disabled={disabled}
                aria-label={t('zoneSearch')}
                placeholder={t('zoneSearch')}
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
                className="ps-9"
              />
            </div>
            <Select
              id={fid('timezone')}
              value={draft.timezone}
              invalid={!!zoneError}
              disabled={disabled}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {!isValidZone(draft.timezone) && <option value="">{t('zonePick')}</option>}
              {zones.list.slice(0, MAX_OPTIONS).map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')} ({offsetLabel(now, z)})
                </option>
              ))}
            </Select>
          </div>
          {query.trim() && zones.matched === 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">{t('zoneNone')}</p>
          )}
        </Field>
      </SectionCard>
    </div>
  );
}
