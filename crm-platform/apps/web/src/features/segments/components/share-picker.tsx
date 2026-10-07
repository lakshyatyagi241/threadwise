'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { Segment } from '../api/schemas';
import {
  filterShareOptions,
  selectedChips,
  selectionSize,
  toggleShare,
  SEGMENT_SHARE_MAX,
  type ShareOption,
  type ShareSelection,
} from '../lib/share';
import { GroupIcon, SearchIcon, XIcon } from './icons';

/**
 * "Specific people": a searchable multi-select of the workspace's members (and teams). The options are checkboxes in a
 * labelled group, so a keyboard or screen-reader user needs nothing beyond Tab and Space; chips above show the picks
 * and remove one each. `error` is the message under the control (set after a failed save, or an empty pick).
 */
export function SharePicker({
  options,
  selection,
  known,
  loading,
  error,
  disabled,
  onChange,
}: {
  options: readonly ShareOption[];
  selection: ShareSelection;
  /** The names the server last sent for this segment, for picks that are no longer among `options`. */
  known?: Segment['sharedWith'];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onChange: (next: ShareSelection) => void;
}) {
  const t = useTranslations('segments.share');
  const uid = useId();
  const [query, setQuery] = useState('');
  const shown = filterShareOptions(options, query);
  const chips = selectedChips(selection, options, known);
  const size = selectionSize(selection);
  const atCap = size >= SEGMENT_SHARE_MAX;
  const isOn = (o: ShareOption) =>
    (o.kind === 'user' ? selection.userIds : selection.teamIds).includes(o.id);

  return (
    <div className="space-y-2 ps-7">
      <p id={`${uid}-count`} aria-live="polite" className="text-xs font-medium">
        {size === 0
          ? t('countNone')
          : selection.teamIds.length > 0
            ? t('countMixed', { people: selection.userIds.length, teams: selection.teamIds.length })
            : t('count', { count: size })}
      </p>

      {chips.length > 0 && (
        <ul aria-label={t('selected')} className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li
              key={`${c.kind}:${c.id}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted py-0.5 ps-2 pe-1 text-xs"
            >
              {c.kind === 'team' && <GroupIcon className="size-3" />}
              <span className="truncate">{c.name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t('remove', { name: c.name })}
                onClick={() => onChange(toggleShare(selection, c.kind, c.id, false))}
                className="inline-flex size-4 items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('searchLabel')}
          aria-describedby={`${uid}-count`}
          placeholder={t('searchPlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-background ps-8 pe-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        />
      </div>

      <fieldset
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-error` : undefined}
        className="thin-scrollbar max-h-52 overflow-auto rounded-md border border-border"
      >
        <legend className="sr-only">{t('listLabel')}</legend>
        {loading && options.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t('loading')}</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {options.length === 0 ? t('noPeople') : t('noMatch')}
          </p>
        ) : (
          <ul>
            {shown.map((o) => {
              const on = isOn(o);
              return (
                <li key={`${o.kind}:${o.id}`}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-primary',
                      on ? 'bg-brand/5' : 'hover:bg-muted',
                      (disabled || (atCap && !on)) && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled || (atCap && !on)}
                      onChange={(e) =>
                        onChange(toggleShare(selection, o.kind, o.id, e.target.checked))
                      }
                      className="accent-[var(--brand)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        {o.kind === 'team' && <GroupIcon className="size-3.5" />}
                        <span className="truncate">{o.name}</span>
                        {o.kind === 'team' && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[11px] font-normal text-muted-foreground">
                            {t('team', { count: o.memberCount ?? 0 })}
                          </span>
                        )}
                      </span>
                      {o.email && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {o.email}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {atCap && (
        <p className="text-xs text-muted-foreground">{t('cap', { max: SEGMENT_SHARE_MAX })}</p>
      )}
      {error && (
        <p id={`${uid}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
