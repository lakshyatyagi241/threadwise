'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { LOCKED_COLUMNS, type ColumnDef, type ColumnGroup, type ColumnId } from '../lib/columns';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  EyeIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
} from './icons';
import { RowMenu, RowMenuItem, RowMenuSeparator } from './row-menu';

/** The name a column shows in its header and in the picker. */
export function useColumnLabel() {
  const t = useTranslations('contacts-attributes-tags.list');
  return (c: ColumnDef) => ('key' in c.label ? t(c.label.key) : c.label.text);
}

/**
 * The small menu at the end of a column header: sort the list by it (when the API can), filter by it (when there is a filter for
 * it), and hide it (every column but the name). Nothing it offers is new: sorting is what the header click did, hiding is what the
 * Columns panel did, and the filter opens the Filter panel on the matching section.
 */
export function ColumnHeaderMenu({
  column,
  label,
  sort,
  onSort,
  onHide,
  onFilter,
}: {
  column: ColumnDef;
  label: string;
  /** `null` when the column cannot be sorted; otherwise the order in force on it (`null` order = not sorted by it). */
  sort: { active: 'asc' | 'desc' | null } | null;
  onSort?: (order: 'asc' | 'desc') => void;
  onHide?: () => void;
  /** Present when the column has a filter. */
  onFilter?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const locked = LOCKED_COLUMNS.includes(column.id);
  const hasSort = sort !== null && onSort;
  const hasHide = !locked && onHide;
  if (!hasSort && !onFilter && !hasHide) return null;
  return (
    <RowMenu
      label={t('columnMenu', { column: label })}
      width={216}
      className="size-6 shrink-0 rounded text-muted-foreground opacity-0 hover:bg-background hover:opacity-100 focus-visible:opacity-100 group-hover/th:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
      trigger={<ChevronDownIcon className="mx-auto size-3.5" />}
    >
      {(close) => (
        <>
          {hasSort && (
            <>
              <RowMenuItem
                onSelect={() => {
                  close();
                  onSort('asc');
                }}
                className={cn(sort.active === 'asc' && 'font-medium text-brand')}
              >
                <ArrowUpIcon /> {t('sortAsc')}
              </RowMenuItem>
              <RowMenuItem
                onSelect={() => {
                  close();
                  onSort('desc');
                }}
                className={cn(sort.active === 'desc' && 'font-medium text-brand')}
              >
                <ArrowDownIcon /> {t('sortDesc')}
              </RowMenuItem>
            </>
          )}
          {onFilter && (
            <RowMenuItem
              onSelect={() => {
                close();
                onFilter();
              }}
            >
              <FilterIcon /> {t('filterByColumn')}
            </RowMenuItem>
          )}
          {hasHide && (
            <>
              {(hasSort || onFilter) && <RowMenuSeparator />}
              <RowMenuItem
                onSelect={() => {
                  close();
                  onHide();
                }}
              >
                <EyeIcon /> {t('hideColumn')}
              </RowMenuItem>
            </>
          )}
        </>
      )}
    </RowMenu>
  );
}

/**
 * The "+" at the end of the header row: every column that is not shown yet, grouped (contact, lifecycle, related, consent,
 * activity, custom properties), with a search box. Picking one shows it at once; the choice is kept like the Columns panel's.
 */
export function AddColumnPicker({
  groups,
  onAdd,
  onAddField,
}: {
  groups: ReadonlyArray<{ group: ColumnGroup; columns: ColumnDef[] }>;
  onAdd: (id: ColumnId) => void;
  /** Opens where a custom property is made; absent when the person may not manage them. */
  onAddField?: () => void;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  const labelOf = useColumnLabel();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      columns: g.columns.filter((c) => labelOf(c).toLowerCase().includes(needle)),
    }))
    .filter((g) => g.columns.length > 0);
  return (
    <RowMenu
      label={t('addColumn')}
      width={288}
      focus="none"
      className="size-7 text-muted-foreground"
      trigger={<PlusIcon className="mx-auto size-4" />}
    >
      {(close) => (
        <div>
          <div className="relative p-1.5">
            <SearchIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchColumns')}
              aria-label={t('searchColumns')}
              className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <div className="thin-scrollbar max-h-[min(22rem,55vh)] overflow-y-auto">
            {shown.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                {groups.length === 0 ? t('allColumnsShown') : t('noColumnMatch')}
              </p>
            )}
            {shown.map((g) => (
              <div key={g.group} role="group" aria-label={t(`columnGroup.${g.group}`)}>
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t(`columnGroup.${g.group}`)}
                </div>
                {g.columns.map((c) => (
                  <RowMenuItem
                    key={c.id}
                    onSelect={() => {
                      close();
                      onAdd(c.id);
                    }}
                  >
                    <PlusIcon className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 truncate">{labelOf(c)}</span>
                  </RowMenuItem>
                ))}
              </div>
            ))}
          </div>
          {onAddField && (
            <>
              <RowMenuSeparator />
              <RowMenuItem
                onSelect={() => {
                  close();
                  onAddField();
                }}
              >
                <PlusIcon className="size-3.5" /> {t('addColumnField')}
              </RowMenuItem>
            </>
          )}
        </div>
      )}
    </RowMenu>
  );
}
