'use client';

import { useTranslations } from 'next-intl';
import { weekIsEmpty, weekMinutes } from '../lib/availability';
import { OverridesSection } from './editor-overrides';
import { SectionCard, useEditor } from './editor-shared';
import { WeeklyHoursEditor } from './weekly-hours-editor';

/** Step 3: the weekly hours (the shared editor) and the date overrides and holidays. */
export function AvailabilityStep() {
  const t = useTranslations('appointments.editor.availability');
  const { draft, set, err, disabled } = useEditor();
  const hoursError = err('hours');
  const empty = weekIsEmpty(draft.week);
  const total = weekMinutes(draft.week);

  return (
    <div className="space-y-4">
      <SectionCard title={t('title')} hint={t('hint')}>
        <WeeklyHoursEditor
          value={draft.week}
          onChange={(w) => set('week', w)}
          disabled={disabled}
        />
        {hoursError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {hoursError}
          </p>
        )}
        {!hoursError && empty && <p className="mt-2 text-xs text-warning">{t('empty')}</p>}
        {!empty && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('total', { hours: Math.floor(total / 60), minutes: total % 60 })}
          </p>
        )}
      </SectionCard>
      <OverridesSection />
    </div>
  );
}
