'use client';

import Link from 'next/link';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { SEGMENT_PREFIX, moveActive, pickerEntries, type Entry } from '../lib/segment-entries';
import { SearchIcon } from './icons';

/** A segment as the dropdown lists it. */
export interface SegmentOption {
  id: string;
  name: string;
  color: string | null;
  memberCount: number | null;
  countApproximate: boolean;
}

export interface GroupOption {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
}

/** What the segments part of the dropdown can say: still loading, failed, or ready (possibly empty). `off`: not allowed to see segments. */
export type SegmentsState = 'off' | 'loading' | 'error' | 'ready';

/** The dropdown's value: '' = everyone, 'imported', 'no_group', a group id, or `segment:<id>`. */
export type PickerValue = string;

/** The name a picker value stands for ("All contacts" when nothing is picked), from the loaded groups and segments. */
export function pickerLabel(
  value: PickerValue,
  groups: readonly GroupOption[],
  segments: readonly SegmentOption[],
  words: { all: string; imported: string; noGroup: string; segmentFallback: string },
): string {
  if (value === '') return words.all;
  if (value === 'imported') return words.imported;
  if (value === 'no_group') return words.noGroup;
  if (value.startsWith(SEGMENT_PREFIX))
    return (
      segments.find((s) => s.id === value.slice(SEGMENT_PREFIX.length))?.name ??
      words.segmentFallback
    );
  return groups.find((g) => g.id === value)?.name ?? words.all;
}

/**
 * The segment and group chooser of the Contact Hub's Filter panel: everyone, the quick lists (imported, no group), then the workspace's
 * Groups and Segments in separate labelled sections, each with its live count. A search box filters all of them; Arrow keys move
 * through the matches and Enter picks one (the search box keeps the focus, as in a combobox).
 */
export function SegmentList({
  value,
  onChange,
  counts,
  groups,
  segments,
  segmentsState,
  canCreateSegment,
  onRetrySegments,
}: {
  value: PickerValue;
  onChange: (value: PickerValue) => void;
  /** Workspace-wide counts of the quick lists (undefined until the stats load). */
  counts: { total?: number; imported?: number; noGroup?: number };
  groups: readonly GroupOption[];
  segments: readonly SegmentOption[];
  segmentsState: SegmentsState;
  canCreateSegment: boolean;
  onRetrySegments: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const uid = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const entries = useMemo<Entry[]>(
    () =>
      pickerEntries({
        q,
        counts,
        groups,
        segments,
        labels: {
          all: t('allContacts'),
          imported: t('imported'),
          noGroup: t('noGroup'),
          approx: (count) => t('segmentApprox', { count }),
        },
      }),
    [q, counts, groups, segments, t],
  );

  const pick = (e: Entry) => onChange(e.value);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const key = e.key;
      setActive((a) => moveActive(a, key, entries.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = entries[Math.min(active, entries.length - 1)];
      if (hit) pick(hit);
    }
  };

  const optionId = (i: number) => `${uid}-opt-${i}`;
  const section = (name: Entry['section'], heading: string | null, empty?: ReactNode) => {
    const rows = entries.filter((e) => e.section === name);
    if (rows.length === 0 && !empty) return null;
    return (
      <div role="group" aria-label={heading ?? t('quickHeading')} className="py-1">
        {heading && (
          <div
            role="presentation"
            className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {heading}
          </div>
        )}
        {rows.map((e) => {
          const i = entries.indexOf(e);
          const selected = e.value === value;
          return (
            <div
              key={e.value || 'all'}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(e)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm',
                i === active && 'bg-muted',
                selected && 'font-medium',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('w-3.5 shrink-0 text-xs', !selected && 'invisible')}
              >
                {'✓'}
              </span>
              {e.color !== undefined && (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: e.color || 'var(--primary)' }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{e.label}</span>
              {e.hint !== undefined && (
                <span className="text-xs text-muted-foreground">{e.hint}</span>
              )}
            </div>
          );
        })}
        {empty}
      </div>
    );
  };

  return (
    <div>
      <div className="relative border-b border-border p-2">
        <SearchIcon className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          autoFocus
          value={q}
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={
            entries.length > 0 ? optionId(Math.min(active, entries.length - 1)) : undefined
          }
          aria-label={t('segmentSearch')}
          placeholder={t('segmentSearch')}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div
        id={`${uid}-list`}
        role="listbox"
        aria-label={t('segmentFilter')}
        className="thin-scrollbar max-h-[min(20rem,50vh)] overflow-y-auto p-1"
      >
        {section('contacts', null)}
        {section('groups', t('groupsHeading'))}
        {segmentsState !== 'off' &&
          section(
            'segments',
            t('segmentsHeading'),
            segmentsState === 'loading' ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">{t('segmentsLoading')}</p>
            ) : segmentsState === 'error' ? (
              <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-warning">
                {t('segmentsFailed')}
                <button
                  type="button"
                  onClick={onRetrySegments}
                  className="font-semibold underline underline-offset-2"
                >
                  {t('segmentsRetry')}
                </button>
              </p>
            ) : segments.length === 0 && q.trim() === '' ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {t('segmentsNone')}{' '}
                {canCreateSegment && (
                  <Link
                    href="/segments/new"
                    className="font-semibold text-foreground underline underline-offset-2"
                  >
                    {t('segmentsCreate')}
                  </Link>
                )}
              </p>
            ) : null,
          )}
        {entries.length === 0 && (
          <p className="px-2.5 py-4 text-center text-sm text-muted-foreground">
            {t('segmentNoMatch')}
          </p>
        )}
      </div>
    </div>
  );
}
