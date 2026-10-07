'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceHubKpis, WorkspaceHubListResponse } from '@crm/contracts';
import { workspaceHubSortSchema, workspaceHubStateFilterSchema } from '@crm/contracts';
import {
  Button,
  Checkbox,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  Select,
  cn,
} from '@crm/ui';
import { COLUMN_IDS, LOCKED_COLUMNS, type ColumnId } from '../lib/columns';
import { ColumnsIcon, RefreshIcon } from './icons';

export type HubFilters = {
  q: string;
  status: string;
  plan: string;
  state: string;
  provider: string;
  low: string;
  sort: string;
};

export const HUB_DEFAULTS: HubFilters = {
  q: '',
  status: 'all',
  plan: '',
  state: '',
  provider: '',
  low: '',
  sort: 'created',
};

export const hasActiveFilter = (f: HubFilters): boolean =>
  (Object.keys(HUB_DEFAULTS) as Array<keyof HubFilters>).some(
    (k) => k !== 'sort' && f[k] !== HUB_DEFAULTS[k],
  );

const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/** Search, status pills with counts, plan, state, provider, low balance, sort, then the column menu and refresh. */
export function WorkspacesToolbar({
  filters,
  search,
  onSearch,
  onChange,
  kpis,
  options,
  visible,
  onColumn,
  onResetColumns,
  onRefresh,
  refreshing,
}: {
  filters: HubFilters;
  search: string;
  onSearch: (q: string) => void;
  onChange: (patch: Partial<HubFilters>) => void;
  kpis: WorkspaceHubKpis | undefined;
  options: WorkspaceHubListResponse['filters'] | undefined;
  visible: readonly ColumnId[];
  onColumn: (id: ColumnId, on: boolean) => void;
  onResetColumns: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations('workspaces-hub.list');
  const tcol = useTranslations('workspaces-hub.list.columns');
  const ts = useTranslations('plans-subscriptions-trials.operator.state');
  const pills: Array<{ id: 'all' | 'active' | 'suspended'; count: number | undefined }> = [
    { id: 'all', count: kpis?.total },
    { id: 'active', count: kpis?.active },
    { id: 'suspended', count: kpis?.suspended },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          role="searchbox"
          className="w-full min-w-48 max-w-sm flex-1"
          aria-label={t('search')}
          placeholder={t('searchPlaceholder')}
          maxLength={120}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <div
          role="group"
          aria-label={t('status.label')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {pills.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={filters.status === p.id}
              onClick={() => onChange({ status: p.id })}
              className={cn(
                'px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                filters.status === p.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted',
              )}
            >
              {t(`status.${p.id}`)}
              {p.count !== undefined && (
                <span className="ms-1.5 tabular-nums opacity-80">{p.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Menu
            label={tcol('menu')}
            align="end"
            triggerClassName="h-9"
            triggerProps={{ 'aria-label': tcol('menu') }}
            trigger={
              <>
                <ColumnsIcon className="size-4" />
                <span className="hidden sm:inline">{tcol('menu')}</span>
              </>
            }
          >
            {COLUMN_IDS.map((c) => (
              <MenuCheckboxItem
                key={c}
                checked={visible.includes(c)}
                disabled={LOCKED_COLUMNS.includes(c)}
                onCheckedChange={(on) => onColumn(c, on)}
              >
                {tcol(c)}
              </MenuCheckboxItem>
            ))}
            <MenuSeparator />
            <MenuItem keepOpen onSelect={onResetColumns}>
              {tcol('reset')}
            </MenuItem>
          </Menu>
          <button
            type="button"
            onClick={onRefresh}
            title={t('refresh')}
            aria-label={t('refresh')}
            className={iconBtn}
          >
            <RefreshIcon className={cn('size-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-auto"
          aria-label={t('plan')}
          value={filters.plan}
          onChange={(e) => onChange({ plan: e.target.value })}
        >
          <option value="">{t('allPlans')}</option>
          {(options?.plans ?? []).map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label={t('state')}
          value={filters.state}
          onChange={(e) => onChange({ state: e.target.value })}
        >
          <option value="">{t('allStates')}</option>
          {workspaceHubStateFilterSchema.options.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label={t('provider')}
          value={filters.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
        >
          <option value="">{t('allProviders')}</option>
          {(options?.providers ?? []).map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </Select>
        <Checkbox
          label={t('lowOnly')}
          checked={filters.low === 'true'}
          onChange={(e) => onChange({ low: e.target.checked ? 'true' : '' })}
        />
        <Select
          className="ms-auto w-auto"
          aria-label={t('sort.label')}
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
        >
          {workspaceHubSortSchema.options.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </Select>
        {hasActiveFilter({ ...filters, q: search }) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearch('');
              onChange({ ...HUB_DEFAULTS, sort: filters.sort });
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
