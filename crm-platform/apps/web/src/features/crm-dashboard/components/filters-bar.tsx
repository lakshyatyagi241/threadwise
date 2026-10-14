'use client';

import { useTranslations } from 'next-intl';
import { CRM_DASH_RANGES, type CrmDashRange } from '@crm/contracts';
import { Button, Input, Select, cn } from '@crm/ui';
import type { Option, PipelineOption } from '../api/service';
import { DEFAULT_FILTERS, hasNarrowing, type DashFilters } from '../lib/query';

/** The period (this month, 7/30/90 days, custom) and the pipeline / owner / team pickers. Everything lands in the address. */
export function FiltersBar({
  filters,
  onChange,
  pipelines,
  owners,
  teams,
  today,
  busy,
}: {
  filters: DashFilters;
  onChange: (patch: Partial<DashFilters>) => void;
  pipelines: PipelineOption[];
  owners: Option[];
  teams: Option[];
  /** The viewer's today (from the last response), the latest day a custom period may end. */
  today: string | undefined;
  busy: boolean;
}) {
  const t = useTranslations('crm-dashboard.filters');
  const picker = 'min-w-0 sm:w-48';
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t('label')} aria-busy={busy}>
      <div role="group" aria-label={t('period')} className="inline-flex overflow-hidden rounded-md border border-border">
        {CRM_DASH_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={filters.range === r}
            onClick={() => onChange({ range: r satisfies CrmDashRange })}
            className={cn(
              'h-10 px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary',
              filters.range === r ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
            )}
          >
            {t(`range.${r}`)}
          </button>
        ))}
      </div>
      {filters.range === 'custom' && (
        <>
          <label className="text-xs text-muted-foreground">
            {t('from')}
            <Input
              type="date"
              value={filters.from}
              max={filters.to || today}
              onChange={(e) => onChange({ from: e.target.value })}
              className="mt-1 w-40"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t('to')}
            <Input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              max={today}
              onChange={(e) => onChange({ to: e.target.value })}
              className="mt-1 w-40"
            />
          </label>
        </>
      )}
      <label className="text-xs text-muted-foreground">
        {t('pipeline')}
        <Select
          value={filters.pipeline}
          onChange={(e) => onChange({ pipeline: e.target.value })}
          className={cn('mt-1', picker)}
        >
          <option value="">{t('allPipelines')}</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-xs text-muted-foreground">
        {t('owner')}
        <Select
          value={filters.owner}
          onChange={(e) => onChange({ owner: e.target.value })}
          className={cn('mt-1', picker)}
        >
          <option value="">{t('everyone')}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </label>
      {teams.length > 0 && (
        <label className="text-xs text-muted-foreground">
          {t('team')}
          <Select
            value={filters.team}
            onChange={(e) => onChange({ team: e.target.value })}
            className={cn('mt-1', picker)}
          >
            <option value="">{t('allTeams')}</option>
            {teams.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {(hasNarrowing(filters) || filters.range !== DEFAULT_FILTERS.range) && (
        <Button type="button" variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          {t('reset')}
        </Button>
      )}
    </div>
  );
}
