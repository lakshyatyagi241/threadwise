'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  MESSAGE_HISTORY_SOURCES,
  MESSAGE_HISTORY_STATUSES,
  MESSAGE_HISTORY_TYPES,
  type MessageHistorySource,
  type MessageHistorySummary,
} from '@crm/contracts';
import { Button, Input, Select, cn } from '@crm/ui';
import { formatCount } from '../lib/format';
import { SCOPE_KEYS, isNarrowed, type HistoryState, type ScopeKey } from '../lib/filters';
import { CrossIcon, SearchIcon } from './parts';

export interface ChannelOption {
  id: string;
  name: string;
}

interface Props {
  state: HistoryState;
  summary: MessageHistorySummary | undefined;
  channels: ChannelOption[];
  onChange: (patch: Partial<HistoryState>) => void;
  onClear: () => void;
}

const TABS = ['all', 'out', 'in', 'fail'] as const;

/**
 * Reference's filter bar: the search, the direction tabs with their counts, the number (device) and type selects. Added here: a status
 * filter, the sending source, and chips for the filters a link brings (a campaign, a broadcast, a scheduled message, a template).
 * Every change is applied at once and written to the address; the search waits for a pause in typing.
 */
export function FilterBar({ state, summary, channels, onChange, onClear }: Props) {
  const t = useTranslations('message-history.filters');
  const type = useTranslations('message-history.type');
  const status = useTranslations('message-history.status');
  const source = useTranslations('message-history.source');
  const locale = useLocale();
  const searchId = useId();

  const [q, setQ] = useState(state.q);
  // The address changed under us (Back, a cleared filter): take its search, during the render rather than in an effect.
  const [seen, setSeen] = useState(state.q);
  if (seen !== state.q) {
    setSeen(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q.trim() === state.q) return;
    const id = window.setTimeout(() => onChange({ q: q.trim() }), 300);
    return () => window.clearTimeout(id);
    // `onChange` closes over the current state; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const counts = summary?.dirCounts;
  const toggleSource = (s: MessageHistorySource) =>
    onChange({
      source: state.source.includes(s) ? state.source.filter((x) => x !== s) : [...state.source, s],
    });
  const chips = SCOPE_KEYS.filter((k) => state[k] !== '');

  return (
    <div className="space-y-3 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-[480px] flex-1">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            {t('search')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="ps-9"
            maxLength={100}
          />
        </div>
        <div
          role="group"
          aria-label={t('directionLabel')}
          className="flex items-center gap-1 rounded-full bg-muted p-1"
        >
          {TABS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={state.dir === d}
              onClick={() => onChange({ dir: d })}
              className={cn(
                'rounded-full px-3 py-1 text-[11.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                state.dir === d
                  ? 'bg-brand text-brand-foreground'
                  : 'text-foreground/70 hover:bg-background',
              )}
            >
              {t(`dir.${d}`)}
              <span className="ms-1 font-mono text-[10px] opacity-80">
                {formatCount(counts?.[d] ?? 0, locale)}
              </span>
            </button>
          ))}
        </div>
        {channels.length > 0 && (
          <Select
            aria-label={t('channel')}
            value={state.channelId}
            onChange={(e) => onChange({ channelId: e.target.value })}
            className="h-9 w-auto min-w-[150px]"
          >
            <option value="">{t('allChannels')}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label={t('type')}
          value={state.type}
          onChange={(e) => onChange({ type: e.target.value as HistoryState['type'] })}
          className="h-9 w-auto min-w-[140px]"
        >
          <option value="">{t('allTypes')}</option>
          {MESSAGE_HISTORY_TYPES.map((x) => (
            <option key={x} value={x}>
              {type(x)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('status')}
          value={state.status}
          onChange={(e) => onChange({ status: e.target.value as HistoryState['status'] })}
          className="h-9 w-auto min-w-[140px]"
        >
          <option value="">{t('allStatuses')}</option>
          {MESSAGE_HISTORY_STATUSES.map((x) => (
            <option key={x} value={x}>
              {status(x)}
            </option>
          ))}
        </Select>
        <details className="relative">
          <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t('sources')}
            {state.source.length > 0 && (
              <span className="ms-1.5 rounded-full bg-brand px-1.5 font-mono text-[10px] text-brand-foreground">
                {state.source.length}
              </span>
            )}
          </summary>
          <fieldset className="absolute end-0 z-20 mt-1 w-56 space-y-1.5 rounded-md border border-border bg-background p-3 shadow-lg">
            <legend className="sr-only">{t('sources')}</legend>
            {MESSAGE_HISTORY_SOURCES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.source.includes(s)}
                  onChange={() => toggleSource(s)}
                  className="size-4 rounded border-border"
                />
                {source(s)}
              </label>
            ))}
          </fieldset>
        </details>
        {isNarrowed(state) && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            {t('clear')}
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label={t('active')}>
          {chips.map((k: ScopeKey) => (
            <li
              key={k}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
            >
              {t(`chip.${k}`)}
              <button
                type="button"
                aria-label={t('removeFilter', { filter: t(`chip.${k}`) })}
                onClick={() => onChange({ [k]: '' } as Partial<HistoryState>)}
                className="rounded-full p-0.5 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <CrossIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
