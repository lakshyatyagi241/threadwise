'use client';

import { useTranslations } from 'next-intl';
import { Button, Input, Select } from '@crm/ui';
import type { CompanySort } from '@crm/contracts';
import type { Member } from '../api/schemas';
import { SORTS, hasActiveFilter, type CompanyFilters } from '../lib/filters';
import { RefreshIcon, SearchIcon } from './icons';

export interface CompaniesToolbarProps {
  filters: CompanyFilters;
  /** What is in the search box right now (it reaches the address after a pause). */
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<CompanyFilters>) => void;
  members: readonly Member[];
  industries: readonly string[];
  onRefresh: () => void;
  refreshing: boolean;
}

/** One compact row: the search box Reference has, then industry, owner, "with open deals", the order, Clear and refresh. */
export function CompaniesToolbar(p: CompaniesToolbarProps) {
  const t = useTranslations('companies.toolbar');
  const f = p.filters;
  const active = hasActiveFilter({ ...f, q: p.q });

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      <div className="relative min-w-48 flex-1 sm:max-w-sm">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={p.q}
          maxLength={100}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-10 ps-9"
        />
      </div>

      <Select
        aria-label={t('industry')}
        className="h-10 w-auto min-w-36 max-w-52"
        value={f.industry}
        onChange={(e) => p.onChange({ industry: e.target.value })}
      >
        <option value="">{t('allIndustries')}</option>
        {f.industry && !p.industries.some((i) => i.toLowerCase() === f.industry.toLowerCase()) && (
          <option value={f.industry}>{f.industry}</option>
        )}
        {p.industries.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </Select>

      <Select
        aria-label={t('owner')}
        className="h-10 w-auto min-w-36 max-w-52"
        value={f.owner}
        onChange={(e) => p.onChange({ owner: e.target.value })}
      >
        <option value="">{t('allOwners')}</option>
        <option value="none">{t('noOwner')}</option>
        {p.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName}
          </option>
        ))}
      </Select>

      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
        <input
          type="checkbox"
          checked={f.openDeals}
          onChange={(e) => p.onChange({ openDeals: e.target.checked })}
          className="size-4 cursor-pointer accent-[var(--brand)]"
        />
        {t('withOpenDeals')}
      </label>

      <Select
        aria-label={t('sort')}
        className="h-10 w-auto min-w-32"
        value={f.sort}
        onChange={(e) => p.onChange({ sort: e.target.value as CompanySort })}
      >
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`sorts.${s}`)}
          </option>
        ))}
      </Select>

      {active && (
        <Button
          variant="ghost"
          onClick={() => p.onChange({ q: '', owner: '', industry: '', openDeals: false })}
        >
          {t('clear')}
        </Button>
      )}
      <Button
        variant="secondary"
        className="ms-auto size-10 px-0"
        onClick={p.onRefresh}
        disabled={p.refreshing}
        aria-label={t('refresh')}
        title={t('refresh')}
      >
        <RefreshIcon className={p.refreshing ? 'animate-spin' : undefined} />
      </Button>
    </div>
  );
}
