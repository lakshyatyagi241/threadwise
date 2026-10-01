'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Input, Select, cn } from '@crm/ui';
import { DEAL_SOURCES, type Member, type Pipeline } from '../api/schemas';
import { hasActiveFilter, type DealFilters, type DealsView } from '../lib/filters';
import { useSourceLabel } from './parts';
import { BoardIcon, ChartIcon, GearIcon, ListIcon, SearchIcon } from './icons';

export interface DealsToolbarProps {
  filters: DealFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<DealFilters>) => void;
  pipelines: readonly Pipeline[];
  pipelineId: string;
  members: readonly Member[];
  canSettings: boolean;
}

/** One row: pipeline, search, owner and source filters, Clear, then the board/list switch and the two side screens. */
export function DealsToolbar(p: DealsToolbarProps) {
  const t = useTranslations('deals-pipelines.toolbar');
  const sourceLabel = useSourceLabel();
  const active = hasActiveFilter({ ...p.filters, q: p.q, status: p.filters.status });
  const views: Array<{ id: DealsView; icon: typeof BoardIcon }> = [
    { id: 'board', icon: BoardIcon },
    { id: 'list', icon: ListIcon },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      {p.pipelines.length > 1 && (
        <Select
          aria-label={t('pipeline')}
          className="w-auto min-w-40 max-w-56"
          value={p.pipelineId}
          onChange={(e) => p.onChange({ pipeline: e.target.value })}
        >
          {p.pipelines.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      )}

      <div className="relative min-w-48 flex-1 sm:max-w-sm">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="ps-9"
        />
      </div>

      <Select
        aria-label={t('owner')}
        className="w-auto min-w-36 max-w-52"
        value={p.filters.owner}
        onChange={(e) => p.onChange({ owner: e.target.value })}
      >
        <option value="">{t('allOwners')}</option>
        <option value="none">{t('unassigned')}</option>
        {p.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName}
          </option>
        ))}
      </Select>

      <Select
        aria-label={t('source')}
        className="w-auto min-w-36 max-w-48"
        value={p.filters.source}
        onChange={(e) => p.onChange({ source: e.target.value as DealFilters['source'] })}
      >
        <option value="">{t('allSources')}</option>
        {DEAL_SOURCES.map((s) => (
          <option key={s} value={s}>
            {sourceLabel(s)}
          </option>
        ))}
      </Select>

      {p.filters.view === 'list' && (
        <Select
          aria-label={t('status')}
          className="w-auto min-w-32"
          value={p.filters.status}
          onChange={(e) => p.onChange({ status: e.target.value as DealFilters['status'] })}
        >
          <option value="">{t('allStatuses')}</option>
          <option value="open">{t('open')}</option>
          <option value="won">{t('won')}</option>
          <option value="lost">{t('lost')}</option>
        </Select>
      )}

      {active && (
        <Button
          variant="ghost"
          onClick={() => {
            p.onQ('');
            p.onChange({ q: '', owner: '', source: '', status: '' });
          }}
        >
          {t('clear')}
        </Button>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t('view')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {views.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={p.filters.view === id}
              onClick={() => p.onChange({ view: id })}
              className={cn(
                'flex h-10 items-center gap-1.5 px-3 text-sm font-medium transition',
                p.filters.view === id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-foreground hover:bg-muted',
              )}
            >
              <Icon /> {t(`views.${id}`)}
            </button>
          ))}
        </div>
        <Link
          href="/deals/reports"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <ChartIcon /> {t('reports')}
        </Link>
        {p.canSettings && (
          <Link
            href="/deals/settings"
            aria-label={t('settings')}
            title={t('settings')}
            className="inline-flex size-10 items-center justify-center rounded-md border border-border hover:bg-muted"
          >
            <GearIcon />
          </Link>
        )}
      </div>
    </div>
  );
}
