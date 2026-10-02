'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import type { FieldDef } from '../lib/fields';
import type { SummaryContext, Translate } from '../lib/summary';

/** What `summarize` needs, from the current language: message lookups, field labels and date formatting. */
export function useSummaryContext(catalog: readonly FieldDef[]): SummaryContext {
  const ts = useTranslations('segments.summary');
  const tf = useTranslations('segments.fields');
  const format = useFormatter();
  return useMemo(
    () => ({
      catalog,
      t: ((key, values) => ts(key, values)) as Translate,
      fieldLabel: (f: FieldDef) => ('key' in f.label ? tf(f.label.key) : f.label.text),
      formatDate: (iso: string) => {
        const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
        return Number.isNaN(d.getTime())
          ? iso
          : format.dateTime(d, { dateStyle: 'medium', timeZone: 'UTC' });
      },
    }),
    [catalog, ts, tf, format],
  );
}
