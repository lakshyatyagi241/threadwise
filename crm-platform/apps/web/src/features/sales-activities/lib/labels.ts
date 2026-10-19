'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import type { ActivityOption, ActivityOptionRef, SalesActivityType } from '@crm/contracts';
import { useVocabulary } from '@/features/persona-vocabulary';

/** "follow_up" -> "Follow up": what a seeded item with no translation yet is drawn as, so nothing shows a raw key twice. */
export function humanKey(key: string): string {
  const s = key.replace(/^custom_/, '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

export interface ActivityLabels {
  /** The name of an activity: the workspace's own for a custom one, the localised word for a default (Meeting follows the workspace vocabulary). */
  activity: (a: Pick<SalesActivityType, 'key' | 'name'>) => string;
  /** The name of a task type or an outcome of the activity with this key. */
  option: (activityKey: string, o: Pick<ActivityOption, 'key' | 'name'>) => string;
  /** The same for the short reference a record carries. */
  ref: (r: Pick<ActivityOptionRef, 'key' | 'name' | 'activityKey'>) => string;
}

/**
 * Names for activities and their lists. A default activity or item carries no name in the data; the words come from
 * `messages/<locale>/sales-activities.json` (`defaults.*`), and the Meeting activity takes the workspace's word for "meeting"
 * (a clinic may call it a visit). A custom one shows the name the workspace typed.
 */
export function useActivityLabels(): ActivityLabels {
  const t = useTranslations('sales-activities');
  const { noun } = useVocabulary();
  const meeting = noun('meeting').singular;
  const activity = useCallback<ActivityLabels['activity']>(
    (a) => {
      if (a.name) return a.name;
      if (a.key === 'meeting') return meeting;
      const k = `defaults.activity.${a.key}`;
      return t.has(k) ? t(k) : humanKey(a.key);
    },
    [t, meeting],
  );
  const option = useCallback<ActivityLabels['option']>(
    (activityKey, o) => {
      if (o.name) return o.name;
      const k = `defaults.option.${activityKey}.${o.key}`;
      return t.has(k) ? t(k) : humanKey(o.key);
    },
    [t],
  );
  const ref = useCallback<ActivityLabels['ref']>((r) => option(r.activityKey, r), [option]);
  return { activity, option, ref };
}
