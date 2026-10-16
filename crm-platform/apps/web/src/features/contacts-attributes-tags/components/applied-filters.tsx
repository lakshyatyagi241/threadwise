'use client';

import { useTranslations } from 'next-intl';
import type { FilterChip } from '../lib/applied-filters';
import { SparkIcon } from './icons';

/**
 * One removable chip per active filter, under the toolbar, with "Clear all" and (when the filters could describe a segment)
 * "Save as segment". Renders nothing when no filter is on.
 */
export function AppliedFilters({
  chips,
  onRemove,
  onClearAll,
  onSaveAsSegment,
}: {
  chips: readonly FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
  /** Present when the person may save the active filters as a segment. */
  onSaveAsSegment?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t('appliedFilters')}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 py-1 ps-2.5 pe-1 text-brand"
        >
          {chip.kind === 'rules' && <SparkIcon />}
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={t('removeFilter', { filter: chip.label })}
            title={t('clearFilter')}
            className="inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="rounded px-1 text-xs font-medium text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('clearAllFilters')}
      </button>
      {onSaveAsSegment && (
        <button
          type="button"
          onClick={onSaveAsSegment}
          title={t('saveAsSegmentHint')}
          className="rounded px-1 text-xs font-medium text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('saveAsSegment')}
        </button>
      )}
    </div>
  );
}
