'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Popover, Spinner, cn } from '@crm/ui';
import { useLabels } from '../api/hooks';
import { LabelChip } from './label-chip';

export interface LabelFilterProps {
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * The list's label filter: a multi-select of the workspace labels. A thread shows when it carries ANY of the chosen labels. The choice
 * lives in the address (`?labels=a,b`), so a filtered view can be shared or reloaded.
 */
export function LabelFilter({ value, onChange }: LabelFilterProps) {
  const t = useTranslations('team-inbox-conversations.labels');
  const [open, setOpen] = useState(false);
  const library = useLabels(true);
  const chosen = new Set(value);
  const labels = library.data?.data ?? [];
  // A label that was deleted since the address was made is dropped from the count.
  const active =
    value.filter((id) => labels.some((l) => l.id === id)).length ||
    (library.data ? 0 : value.length);

  if (library.data && labels.length === 0 && value.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="inbox-label-filter"
        aria-expanded={open}
        aria-label={t('filter')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          active > 0 && 'border-primary text-primary',
        )}
      >
        {active > 0 ? t('filterActive', { count: active }) : t('filter')}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('filter')}
        className="start-0 end-auto w-64"
      >
        {library.isPending && <Spinner />}
        <ul className="max-h-60 space-y-0.5 overflow-y-auto thin-scrollbar">
          {labels.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={chosen.has(l.id)}
                  onChange={() =>
                    onChange(chosen.has(l.id) ? value.filter((v) => v !== l.id) : [...value, l.id])
                  }
                />
                <LabelChip label={l} className="max-w-[10rem] text-xs" />
                <span className="ms-auto text-xs text-muted-foreground">{l.conversationCount}</span>
              </label>
            </li>
          ))}
        </ul>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('clearFilter')}
          </button>
        )}
      </Popover>
    </div>
  );
}
