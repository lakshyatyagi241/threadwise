'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  cn,
} from '@crm/ui';
import type { ContactFilters } from '../api/contacts';
import type { ContactGroup, ContactStats } from '../api/schemas';
import type { ColumnDef, ColumnId } from '../lib/columns';
import type { Choice } from '../lib/option-sets';
import { BulkPickers, type BulkPicker, type TagChoice } from './bulk-bar';
import {
  ChevronDownIcon,
  DownloadIcon,
  FilterIcon,
  GridIcon,
  ListIcon,
  MergeIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  UploadIcon,
  UsersPlusIcon,
} from './icons';

/** The segment dropdown's value: '' = everyone, 'imported', 'no_group', or a group id. */
export type SegmentValue = string;

export const segmentOf = (f: Pick<ContactFilters, 'group' | 'imported'>): SegmentValue =>
  f.imported ? 'imported' : f.group;

export interface ContactsToolbarProps {
  q: string;
  onQ: (q: string) => void;

  segment: SegmentValue;
  onSegment: (value: SegmentValue) => void;
  stats: ContactStats | undefined;
  groups: readonly ContactGroup[];

  tag: string;
  onTag: (id: string) => void;
  tags: ReadonlyArray<{ id: string; name: string }>;

  stage: string;
  onStage: (v: string) => void;
  stages: readonly Choice[];
  consent: ContactFilters['consent'];
  onConsent: (v: ContactFilters['consent']) => void;
  order: ContactFilters['order'];
  onOrder: (v: ContactFilters['order']) => void;

  /** Selected rows, or `null` when the selection stands for everything matching the filter. */
  selectedCount: number | null;
  anySelected: boolean;
  busy: boolean;
  onClearSelection: () => void;
  onSendCampaign: () => void;

  can: {
    update: boolean;
    delete: boolean;
    export: boolean;
    import: boolean;
    merge: boolean;
    createGroups: boolean;
    createTags: boolean;
  };
  exporting: boolean;
  onExportAll: () => void;
  onExportSelected: () => void;
  onImport: () => void;
  onDedupe: () => void;
  onNewGroup: () => void;
  onDeleteSelected: () => void;
  picker: BulkPicker;
  onPicker: (p: BulkPicker) => void;
  onGroup: (action: 'add' | 'remove', groupId: string) => Promise<boolean>;
  onTagApply: (action: 'add' | 'remove', choice: TagChoice) => Promise<boolean>;

  allColumns: readonly ColumnDef[];
  visibleIds: ReadonlySet<ColumnId>;
  onColumn: (id: ColumnId, on: boolean) => void;
  onResetColumns: () => void;

  view: 'list' | 'grid';
  onView: (v: 'list' | 'grid') => void;

  onRefresh: () => void;
  /** The list is being fetched (the refresh icon spins). */
  refreshing: boolean;
}

const n = (v: number | undefined) => (v === undefined ? undefined : v.toLocaleString());
const trigger = 'h-9 gap-2 whitespace-nowrap';
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
 * The single toolbar row of the Contact Hub: search, segment, tag, filters, Send campaign, More actions, and Modify
 * columns at the far end. It owns no state; the screen passes everything in.
 */
export function ContactsToolbar(p: ContactsToolbarProps) {
  const t = useTranslations('contacts-attributes-tags.list');
  const tb = useTranslations('contacts-attributes-tags.bulk');
  // A viewer can do none of these: an empty dropdown would only be a button that opens nothing.
  const hasMoreActions = Object.values(p.can).some(Boolean);

  const segmentLabel =
    p.segment === ''
      ? t('selectSegment')
      : p.segment === 'imported'
        ? t('imported')
        : p.segment === 'no_group'
          ? t('noGroup')
          : (p.groups.find((g) => g.id === p.segment)?.name ?? t('selectSegment'));
  const tagLabel = p.tags.find((x) => x.id === p.tag)?.name ?? t('selectTag');
  const filtersOn = Number(p.stage !== '') + Number(p.consent !== '');
  const none = !p.anySelected;
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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={search}
            type="search"
            value={p.q}
            onChange={(e) => p.onQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            aria-keyshortcuts="Control+K Meta+K"
            className="h-9 ps-9 pe-16 [&::-webkit-search-cancel-button]:hidden"
          />
          {p.q === '' && (
            <kbd
              aria-hidden="true"
              dir="ltr"
              className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground"
            >
              {shortcut}
            </kbd>
          )}
        </div>

        <Menu
          label={t('segmentFilter')}
          trigger={
            <>
              <span
                className={cn(
                  'max-w-[11rem] truncate',
                  p.segment === '' && 'text-muted-foreground',
                )}
              >
                {segmentLabel}
              </span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </>
          }
          triggerClassName={trigger}
        >
          <MenuRadioItem
            checked={p.segment === ''}
            onSelect={() => p.onSegment('')}
            hint={n(p.stats?.total)}
          >
            {t('allContacts')}
          </MenuRadioItem>
          <MenuRadioItem
            checked={p.segment === 'imported'}
            onSelect={() => p.onSegment('imported')}
            hint={n(p.stats?.imported)}
          >
            {t('imported')}
          </MenuRadioItem>
          <MenuRadioItem
            checked={p.segment === 'no_group'}
            onSelect={() => p.onSegment('no_group')}
            hint={n(p.stats?.noGroup)}
          >
            {t('noGroup')}
          </MenuRadioItem>
          {p.groups.length > 0 && <MenuSeparator />}
          {p.groups.length > 0 && <MenuLabel>{t('groupsHeading')}</MenuLabel>}
          {p.groups.map((g) => (
            <MenuRadioItem
              key={g.id}
              checked={p.segment === g.id}
              onSelect={() => p.onSegment(g.id)}
              hint={g.memberCount.toLocaleString()}
            >
              <span
                aria-hidden="true"
                className="me-2 inline-block size-2 rounded-full align-middle"
                style={{ background: g.color || 'var(--primary)' }}
              />
              {g.name}
            </MenuRadioItem>
          ))}
        </Menu>

        <Menu
          label={t('tagFilter')}
          trigger={
            <>
              <span
                className={cn('max-w-[11rem] truncate', p.tag === '' && 'text-muted-foreground')}
              >
                {tagLabel}
              </span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </>
          }
          triggerClassName={trigger}
        >
          <MenuRadioItem checked={p.tag === ''} onSelect={() => p.onTag('')}>
            {t('allTags')}
          </MenuRadioItem>
          {p.tags.map((x) => (
            <MenuRadioItem key={x.id} checked={p.tag === x.id} onSelect={() => p.onTag(x.id)}>
              {x.name}
            </MenuRadioItem>
          ))}
        </Menu>

        <Menu
          label={t('moreFilters')}
          trigger={
            <>
              <FilterIcon className="size-4 text-muted-foreground" />
              {t('filters')}
              {filtersOn > 0 && (
                <span className="rounded-full bg-brand px-1.5 text-[11px] leading-5 text-brand-foreground">
                  {filtersOn}
                </span>
              )}
            </>
          }
          triggerClassName={trigger}
        >
          <MenuLabel>{t('stageFilter')}</MenuLabel>
          <MenuRadioItem checked={p.stage === ''} onSelect={() => p.onStage('')}>
            {t('allStages')}
          </MenuRadioItem>
          {p.stages.map((x) => (
            <MenuRadioItem
              key={x.value}
              checked={p.stage === x.value}
              onSelect={() => p.onStage(x.value)}
            >
              {x.label}
            </MenuRadioItem>
          ))}
          <MenuSeparator />
          <MenuLabel>{t('consentFilter')}</MenuLabel>
          {(
            [
              ['', t('allConsent')],
              ['subscribed', t('subscribedOnly')],
              ['unsubscribed', t('unsubscribedOnly')],
            ] as const
          ).map(([v, label]) => (
            <MenuRadioItem
              key={v || 'all'}
              checked={p.consent === v}
              onSelect={() => p.onConsent(v)}
            >
              {label}
            </MenuRadioItem>
          ))}
          <MenuSeparator />
          <MenuLabel>{t('sort')}</MenuLabel>
          <MenuRadioItem checked={p.order === 'desc'} onSelect={() => p.onOrder('desc')}>
            {t('newestFirst')}
          </MenuRadioItem>
          <MenuRadioItem checked={p.order === 'asc'} onSelect={() => p.onOrder('asc')}>
            {t('oldestFirst')}
          </MenuRadioItem>
        </Menu>

        <Button
          variant="secondary"
          className={trigger}
          disabled={none || p.busy}
          onClick={p.onSendCampaign}
          title={none ? t('sendCampaignHint') : undefined}
        >
          <SendIcon />
          {t('sendCampaign')}
        </Button>

        {hasMoreActions && (
          <div className="relative">
            <Menu
              label={t('moreActions')}
              triggerClassName={trigger}
              trigger={
                <>
                  {t('moreActions')}
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                </>
              }
            >
              {p.can.export && (
                <MenuItem onSelect={p.onExportAll} disabled={p.exporting}>
                  <DownloadIcon /> {t('exportAll')}
                </MenuItem>
              )}
              {p.can.import && (
                <MenuItem onSelect={p.onImport}>
                  <UploadIcon /> {t('bulkUpload')}
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
              {(p.can.export || p.can.update || p.can.delete) && (
                <>
                  <MenuSeparator />
                  <MenuLabel>{none ? t('selectedActionsNone') : t('selectedActions')}</MenuLabel>
                </>
              )}
              {p.can.export && (
                <MenuItem onSelect={p.onExportSelected} disabled={none || p.busy}>
                  {tb('export')}
                </MenuItem>
              )}
              {p.can.update && (
                <>
                  <MenuItem onSelect={() => p.onPicker('groupAdd')} disabled={none || p.busy}>
                    {tb('addToGroup')}
                  </MenuItem>
                  <MenuItem onSelect={() => p.onPicker('groupRemove')} disabled={none || p.busy}>
                    {tb('removeFromGroup')}
                  </MenuItem>
                  <MenuItem onSelect={() => p.onPicker('tagAdd')} disabled={none || p.busy}>
                    {tb('tag')}
                  </MenuItem>
                  <MenuItem onSelect={() => p.onPicker('tagRemove')} disabled={none || p.busy}>
                    {tb('untag')}
                  </MenuItem>
                </>
              )}
              {p.can.delete && (
                <MenuItem danger onSelect={p.onDeleteSelected} disabled={none || p.busy}>
                  {tb('delete')}
                </MenuItem>
              )}
            </Menu>
            <BulkPickers
              picker={p.picker}
              canCreateTags={p.can.createTags}
              onClose={() => p.onPicker(null)}
              onGroup={p.onGroup}
              onTag={p.onTagApply}
            />
          </div>
        )}

        <div className="ms-auto flex items-center gap-2">
          <Menu
            label={t('modifyColumns')}
            align="end"
            triggerClassName={cn(iconBtn, 'px-0')}
            triggerProps={{ 'aria-label': t('modifyColumns'), title: t('modifyColumns') }}
            trigger={<SettingsIcon className="size-4" />}
          >
            {p.allColumns.map((c) => {
              const locked = c.id === 'name';
              return (
                <MenuCheckboxItem
                  key={c.id}
                  checked={p.visibleIds.has(c.id)}
                  disabled={locked}
                  onCheckedChange={(on) => p.onColumn(c.id, on)}
                >
                  {'key' in c.label ? t(c.label.key) : c.label.text}
                </MenuCheckboxItem>
              );
            })}
            <MenuSeparator />
            <MenuItem keepOpen onSelect={p.onResetColumns}>
              {t('resetColumns')}
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
          <div
            role="group"
            aria-label={t('viewToggle')}
            className="inline-flex overflow-hidden rounded-md border border-border"
          >
            {(['list', 'grid'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={p.view === v}
                title={t(v === 'list' ? 'listView' : 'gridView')}
                aria-label={t(v === 'list' ? 'listView' : 'gridView')}
                onClick={() => p.onView(v)}
                className={cn(
                  'inline-flex size-9 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  p.view === v ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
                )}
              >
                {v === 'list' ? <ListIcon /> : <GridIcon />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {p.anySelected && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span className="font-medium" aria-live="polite">
            {p.selectedCount === null
              ? tb('allMatching')
              : tb('selected', { count: p.selectedCount })}
          </span>
          <button
            type="button"
            onClick={p.onClearSelection}
            className="text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {tb('clear')}
          </button>
        </div>
      )}
    </div>
  );
}
