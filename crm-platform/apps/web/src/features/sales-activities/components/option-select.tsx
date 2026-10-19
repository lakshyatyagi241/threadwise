'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@crm/ui';
import type { ActivityOptionRef } from '@crm/contracts';
import { useActivitySettings } from '../api/activity-types';
import { useActivityLabels } from '../lib/labels';

/**
 * The picker of a task type or an outcome from the workspace's current list for the Task, Meeting or Phone activity. It draws nothing
 * until the lists are known, and nothing when the activity has no such list (or outcomes are switched off) unless the record already
 * holds one: that one stays visible, marked as removed, and is kept unless the person picks another.
 */
export function OptionSelect({
  activity,
  kind,
  value,
  current,
  onChange,
  id,
  label,
  emptyLabel,
  disabled,
  className,
}: {
  activity: 'task' | 'meeting' | 'phone';
  kind: 'type' | 'outcome';
  /** The chosen item's id, or '' for none. */
  value: string;
  /** What the record holds now (so a removed item can still be shown). */
  current?: ActivityOptionRef | null;
  onChange: (id: string) => void;
  id: string;
  label: string;
  emptyLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('sales-activities.picker');
  const labels = useActivityLabels();
  const { activity: a, outcomesEnabled } = useActivitySettings(activity);
  const list = kind === 'type' ? (a?.taskTypes ?? []) : (a?.outcomes ?? []);
  const offered = kind === 'type' ? list.length > 0 : outcomesEnabled && list.length > 0;
  const keep = current && !list.some((o) => o.id === current.id) ? current : null;
  if (!a || (!offered && !keep)) return null;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {keep && (
          <option value={keep.id}>
            {labels.ref(keep)} {t('removedSuffix')}
          </option>
        )}
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {labels.option(a.key, o)}
          </option>
        ))}
      </Select>
    </div>
  );
}
