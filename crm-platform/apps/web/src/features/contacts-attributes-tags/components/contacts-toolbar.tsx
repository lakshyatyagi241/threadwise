'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Menu, MenuItem, MenuSeparator, cn } from '@crm/ui';
import { filtersOfPicker, pickerValue } from '../lib/segment-entries';
import type { ContactFilters } from '../api/contacts';
import type { ColumnDef, ColumnId } from '../lib/columns';
import { ColumnsModal } from './columns-modal';
import { FilterPanel, type FilterPanelProps } from './filter-panel';
import {
  ColumnsIcon,
  DownloadIcon,
  EyeIcon,
  KanbanIcon,
  ListIcon,
  MergeIcon,
  MoreIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  UploadIcon,
  UsersPlusIcon,
} from './icons';

/** The segment dropdown's value: '' = everyone, 'imported', 'no_group', a group id, or `segment:<id>`. */
export type SegmentValue = string;

export const segmentOf = (
  f: Pick<ContactFilters, 'group' | 'imported' | 'segment'>,
): SegmentValue => pickerValue(f);

/** The filters a picker value stands for: picking a group, a segment or a quick list replaces the previous pick. */
export const filtersOfSegment = (
  value: SegmentValue,
): Pick<ContactFilters, 'group' | 'imported' | 'segment'> => filtersOfPicker(value);

export interface ContactsToolbarProps {
  q: string;
  onQ: (q: string) => void;
  /** Each new number moves the cursor into the search box (a column header's "Filter" on name, phone or email). */
  focusSearch: number;

  /** The Filter button and its panel. */
  filter: FilterPanelProps;

  allColumns: readonly ColumnDef[];
  /** The columns drawn now, in order. */
  columnIds: readonly ColumnId[];
  /** Save from the columns dialog: the chosen columns in their chosen order. */
  onApplyColumns: (ids: ColumnId[]) => void;
  onResetColumns: () => void;
  /** Opens where a custom field is made (it then shows up as a column); absent when the caller may not manage fields. */
  onAddColumnField?: () => void;

  /** Present when the person may create a saved view: the "Create View" button opens the view editor. */
  onCreateView?: () => void;

  view: 'list' | 'kanban';
  onView: (v: 'list' | 'kanban') => void;

  /** Present when the person may create contacts. */
  onAdd?: () => void;

  can: { export: boolean; import: boolean; merge: boolean; createGroups: boolean };
  exporting: boolean;
  onExportAll: () => void;
  onImport: () => void;
  onDedupe: () => void;
  onNewGroup: () => void;
  showStats: boolean;
  onToggleStats: () => void;
  /** Present when the person may save the active filters as a segment. */
  onSaveAsSegment?: () => void;

  onRefresh: () => void;
  /** The list is being fetched (the refresh icon spins). */
  refreshing: boolean;
}

const tool =
  'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';
const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';

/** "Ctrl K", or the Command-key form on Apple platforms (known only on the client, so the first render says Ctrl). */
function useShortcutLabel() {
  return useSyncExternalStore(
    () => () => undefined,
    () => (/mac|iphone|ipad/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'),
    () => 'Ctrl K',
  );
}

/**
 * The one slim row of the Contact Hub: search, Filter, Columns (with how many are shown), Create View, the list/board toggle, the
 * primary "Add Contact", the "..." menu (import, export, merge duplicates, new group, stats) and refresh. Segment, tag and owner live in
 * the Filter panel; sorting is on the column headers; the bulk actions are in the selection bar. It owns no state of its own beyond
 * which panel is open; the screen passes everything in.
 */
export function ContactsToolbar(p: ContactsToolbarProps) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [columnsOpen, setColumnsOpen] = useState(false);
  // The panel closes on a press outside it, the button included; this stops that press from reopening it.
  const wasOpen = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const shortcut = useShortcutLabel();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (p.focusSearch > 0) search.current?.focus();
  }, [p.focusSearch]);

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={search}
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('searchContacts')}
          aria-label={t('search')}
          aria-keyshortcuts="Control+K Meta+K"
          className="h-9 ps-9 pe-16 [&::-webkit-search-cancel-button]:hidden"
        />
        {p.q === '' && (
          <kbd
            aria-hidden="true"
            dir="ltr"
            className="pointer-events-none absolute end-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground sm:block"
          >
            {shortcut}
          </kbd>
        )}
      </div>

      <FilterPanel {...p.filter} />

      <div className="sm:relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={columnsOpen}
          onPointerDown={() => (wasOpen.current = columnsOpen)}
          onClick={() => setColumnsOpen(!wasOpen.current)}
          className={tool}
        >
          <ColumnsIcon className="size-4 text-muted-foreground" />
          {t('columns')}
          <span
            aria-label={t('columnsCount', { count: p.columnIds.length })}
            className="rounded-full bg-muted px-1.5 text-[11px] leading-5 text-muted-foreground"
          >
            {p.columnIds.length}
          </span>
        </button>
        <ColumnsModal
          open={columnsOpen}
          allColumns={p.allColumns}
          current={p.columnIds}
          onSave={p.onApplyColumns}
          onReset={p.onResetColumns}
          onAddField={p.onAddColumnField}
          onClose={() => setColumnsOpen(false)}
        />
      </div>

      {p.onCreateView && (
        <button type="button" onClick={p.onCreateView} className={cn(tool, 'max-sm:hidden')}>
          <EyeIcon className="size-4 text-muted-foreground" />
          {t('createView')}
        </button>
      )}

      <div className="ms-auto flex items-center gap-2">
        <div
          role="group"
          aria-label={t('viewToggle')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {(['list', 'kanban'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={p.view === v}
              title={t(v === 'list' ? 'listView' : 'kanbanView')}
              aria-label={t(v === 'list' ? 'listView' : 'kanbanView')}
              onClick={() => p.onView(v)}
              className={cn(
                'inline-flex size-9 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                p.view === v ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
              )}
            >
              {v === 'list' ? <ListIcon /> : <KanbanIcon />}
            </button>
          ))}
        </div>

        {p.onAdd && (
          <Button variant="brand" className="h-9 px-4" onClick={p.onAdd}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t('addContactShort')}</span>
          </Button>
        )}

        <Menu
          label={t('moreActions')}
          align="end"
          triggerClassName="size-9 px-0 text-muted-foreground"
          triggerProps={{ 'aria-label': t('moreActions'), title: t('moreActions') }}
          trigger={<MoreIcon />}
        >
          {p.can.import && (
            <MenuItem onSelect={p.onImport}>
              <UploadIcon /> {t('bulkUpload')}
            </MenuItem>
          )}
          {p.can.export && (
            <MenuItem onSelect={p.onExportAll} disabled={p.exporting}>
              <DownloadIcon /> {t('exportAll')}
            </MenuItem>
          )}
          {p.can.merge && (
            <MenuItem onSelect={p.onDedupe}>
              <MergeIcon /> {t('dedupe')}
            </MenuItem>
          )}
          {p.can.createGroups && (
            <MenuItem onSelect={p.onNewGroup}>
              <UsersPlusIcon /> {t('newGroup')}
            </MenuItem>
          )}
          {p.onSaveAsSegment && (
            <MenuItem onSelect={p.onSaveAsSegment}>
              <EyeIcon /> {t('saveAsSegment')}
            </MenuItem>
          )}
          {(p.can.import ||
            p.can.export ||
            p.can.merge ||
            p.can.createGroups ||
            p.onSaveAsSegment) && <MenuSeparator />}
          <MenuItem onSelect={p.onToggleStats}>
            {p.showStats ? t('hideStats') : t('showStats')}
          </MenuItem>
        </Menu>

        <button
          type="button"
          onClick={p.onRefresh}
          title={t('refresh')}
          aria-label={t('refresh')}
          className={iconBtn}
        >
          <RefreshIcon className={cn('size-4', p.refreshing && 'animate-spin')} />
        </button>
      </div>
    </div>
  );
}
