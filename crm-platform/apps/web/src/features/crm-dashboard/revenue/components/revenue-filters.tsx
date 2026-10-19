'use client';

import { useTranslations } from 'next-intl';
import { REVENUE_COMPARES, REVENUE_GROUPS, REVENUE_RANGES } from '@crm/contracts';
import { Button, Input, Select, cn } from '@crm/ui';
import type { Option } from '../../api/service';
import { DEFAULT_FILTERS, isDefault, type RevenueFilters } from '../lib/query';

/** The period, the comparison, the split and the owner / team / currency pickers. Everything lands in the address. */
export function RevenueFiltersBar({
  filters,
  onChange,
  owners,
  teams,
  currencies,
  workspaceCurrency,
  today,
  busy,
}: {
  filters: RevenueFilters;
  onChange: (patch: Partial<RevenueFilters>) => void;
  owners: Option[];
  teams: Option[];
  /** The currencies that occur in the caller's scope (from the last response). */
  currencies: string[];
  workspaceCurrency: string;
  /** The viewer's today (from the last response), the latest day a custom period may end. */
  today: string | undefined;
  busy: boolean;
}) {
  const t = useTranslations('crm-revenue.filters');
  const picker = 'min-w-0 sm:w-44';
  // The picked currency stays in the list even when the last response did not mention it.
  const codes = [
    ...new Set([...currencies, ...(filters.currency ? [filters.currency] : [])]),
  ].sort();
  return (
    <div
      className="flex flex-wrap items-end gap-3"
      role="group"
      aria-label={t('label')}
      aria-busy={busy}
    >
      <div
        role="group"
        aria-label={t('period')}
        className="inline-flex flex-wrap overflow-hidden rounded-md border border-border"
      >
        {REVENUE_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={filters.range === r}
            onClick={() => onChange({ range: r })}
            className={cn(
              'h-10 px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary',
              filters.range === r
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted',
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
        {t('compare')}
        <Select
          value={filters.compare}
          onChange={(e) => onChange({ compare: e.target.value as RevenueFilters['compare'] })}
          className={cn('mt-1', picker)}
        >
          {REVENUE_COMPARES.map((c) => (
            <option key={c} value={c}>
              {t(`compareOption.${c}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="text-xs text-muted-foreground">
        {t('groupBy')}
        <Select
          value={filters.group}
          onChange={(e) => onChange({ group: e.target.value as RevenueFilters['group'] })}
          className={cn('mt-1', picker)}
        >
          {REVENUE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {t(`groupOption.${g}`)}
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
      {codes.length > 1 || filters.currency !== '' ? (
        <label className="text-xs text-muted-foreground">
          {t('currency')}
          <Select
            value={filters.currency}
            onChange={(e) => onChange({ currency: e.target.value })}
            className={cn('mt-1', picker)}
          >
            <option value="">{t('allCurrencies', { currency: workspaceCurrency })}</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {!isDefault(filters) && (
        <Button type="button" variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
          {t('reset')}
        </Button>
      )}
    </div>
  );
}
