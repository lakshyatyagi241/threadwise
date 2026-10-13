'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
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
import { filtersOfPicker, pickerValue } from '../lib/segment-entries';
import { SegmentPicker, type SegmentOption, type SegmentsState } from './segment-picker';
import { ownerTokens, UNASSIGNED_OWNER, type ContactFilters } from '../api/contacts';
import type { Owner } from '../api/owners';
import type { ContactGroup, ContactStats } from '../api/schemas';
import type { ColumnDef, ColumnId } from '../lib/columns';
import type { Choice } from '../lib/option-sets';
import { AdvancedFilter } from '@/features/segments';
import { ColumnsModal } from './columns-modal';
import { BulkPickers, type BulkPicker, type TagChoice } from './bulk-bar';
import {
  ChevronDownIcon,
  DownloadIcon,
  FilterIcon,
  KanbanIcon,
  ListIcon,
  MergeIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  UploadIcon,
  UsersPlusIcon,
} from './icons';

/** The segment dropdown's value: '' = everyone, 'imported', 'no_group', a group id, or `segment:<id>`. */
export type SegmentValue = string;

export const segmentOf = (
  f: Pick<ContactFilters, 'group' | 'imported' | 'segment'>,
): SegmentValue => pickerValue(f);

/** The filters a dropdown value stands for: picking a group, a segment or a quick list replaces the previous pick. */
export const filtersOfSegment = (
  value: SegmentValue,
): Pick<ContactFilters, 'group' | 'imported' | 'segment'> => filtersOfPicker(value);

export interface ContactsToolbarProps {
  q: string;
  onQ: (q: string) => void;

  segment: SegmentValue;
  onSegment: (value: SegmentValue) => void;
  stats: ContactStats | undefined;
  groups: readonly ContactGroup[];
  /** The workspace's segments for the dropdown's Segments section (empty while `segmentsState` is not `ready`). */
  segments: readonly SegmentOption[];
  segmentsState: SegmentsState;
  onRetrySegments: () => void;
  /** Present when the person may save the active filters as a segment: the button then shows. */
  onSaveAsSegment?: () => void;
  canCreateSegment: boolean;

  /** Ad-hoc conditions applied now (JSON text of a rule tree), or empty. */
  rules: string;
  onRules: (rulesJson: string) => void;

  tag: string;
  onTag: (id: string) => void;
  tags: ReadonlyArray<{ id: string; name: string }>;

  /** Owner filter tokens: people's ids and/or `none` (contacts nobody owns), comma-separated; empty = everyone. */
  owner: string;
  onOwner: (value: string) => void;
  owners: readonly Owner[];
  /** The signed-in person, for "My contacts". */
  meId: string;
  /**
   * Present when the filter names exactly one person and the caller may change owners: selects everything the view matches and
   * opens the owner change (the shortcut for "move all of this person's contacts").
   */
  onReassignView?: () => void;

  stage: string;
  onStage: (v: string) => void;
  stages: readonly Choice[];
  consent: ContactFilters['consent'];
  onConsent: (v: ContactFilters['consent']) => void;
  /** `null` while a column's sort is in force (neither "newest" nor "oldest" is then the order). */
  order: ContactFilters['order'] | null;
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
  /** The columns drawn now, in order. */
  columnIds: readonly ColumnId[];
  /** Save from the columns dialog: the chosen columns in their chosen order. */
  onApplyColumns: (ids: ColumnId[]) => void;
  onResetColumns: () => void;
  /** Opens the bulk Update dialog for the selected contacts. */
  onUpdateSelected: () => void;
  /** Opens where a custom field is made (it then shows up as a column); absent when the caller may not manage fields. */
  onAddColumnField?: () => void;

  view: 'list' | 'kanban';
  onView: (v: 'list' | 'kanban') => void;

  onRefresh: () => void;
  /** The list is being fetched (the refresh icon spins). */
  refreshing: boolean;
}

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
  const [columnsOpen, setColumnsOpen] = useState(false);
  // The panel closes on a press outside it, the button included; this stops that press from reopening it.
  const wasOpen = useRef(false);
  const tb = useTranslations('contacts-attributes-tags.bulk');
  // A viewer can do none of these: an empty dropdown would only be a button that opens nothing.
  const hasMoreActions = Object.values(p.can).some(Boolean);

  const tagLabel = p.tags.find((x) => x.id === p.tag)?.name ?? t('selectTag');
  const filtersOn = Number(p.stage !== '') + Number(p.consent !== '');
  const pickedOwners = ownerTokens(p.owner);
  const ownerLabel =
    pickedOwners.length === 0
      ? t('selectOwner')
      : pickedOwners.length > 1
        ? t('ownersCount', { count: pickedOwners.length })
        : pickedOwners[0] === UNASSIGNED_OWNER
          ? t('unassigned')
          : pickedOwners[0] === p.meId
            ? t('myContacts')
            : (p.owners.find((o) => o.id === pickedOwners[0])?.fullName ?? t('ownerFormer'));
  const toggleOwner = (token: string, on: boolean) => {
    const next = pickedOwners.filter((x) => x !== token);
    p.onOwner((on ? [...next, token] : next).join(','));
  };
  const onlyPerson =
    pickedOwners.length === 1 && pickedOwners[0] !== UNASSIGNED_OWNER ? pickedOwners[0] : undefined;
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

        <SegmentPicker
          value={p.segment}
          onChange={p.onSegment}
          counts={{ total: p.stats?.total, imported: p.stats?.imported, noGroup: p.stats?.noGroup }}
          groups={p.groups}
          segments={p.segments}
          segmentsState={p.segmentsState}
          canCreateSegment={p.canCreateSegment}
          onRetrySegments={p.onRetrySegments}
        />

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
          label={t('ownerFilter')}
          trigger={
            <>
              <span
                className={cn(
                  'max-w-[11rem] truncate',
                  pickedOwners.length === 0 && 'text-muted-foreground',
                )}
              >
                {ownerLabel}
              </span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </>
          }
          triggerClassName={trigger}
        >
          <MenuRadioItem checked={pickedOwners.length === 0} onSelect={() => p.onOwner('')}>
            {t('allOwners')}
          </MenuRadioItem>
          <MenuRadioItem
            checked={pickedOwners.length === 1 && pickedOwners[0] === p.meId}
            onSelect={() => p.onOwner(p.meId)}
          >
            {t('myContacts')}
          </MenuRadioItem>
          <MenuSeparator />
          <MenuCheckboxItem
            checked={pickedOwners.includes(UNASSIGNED_OWNER)}
            onCheckedChange={(on) => toggleOwner(UNASSIGNED_OWNER, on)}
          >
            {t('unassigned')}
          </MenuCheckboxItem>
          {p.owners.map((o) => (
            <MenuCheckboxItem
              key={o.id}
              checked={pickedOwners.includes(o.id)}
              onCheckedChange={(on) => toggleOwner(o.id, on)}
            >
              {o.id === p.meId ? t('ownerMe', { name: o.fullName }) : o.fullName}
            </MenuCheckboxItem>
          ))}
          {p.onReassignView && onlyPerson && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={p.onReassignView}>
                {t('reassignView', {
                  name: p.owners.find((o) => o.id === onlyPerson)?.fullName ?? t('ownerFormer'),
                })}
              </MenuItem>
            </>
          )}
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

        <AdvancedFilter value={p.rules} onApply={p.onRules} />

        {p.onSaveAsSegment && (
          <Button
            variant="secondary"
            className={trigger}
            onClick={p.onSaveAsSegment}
            title={t('saveAsSegmentHint')}
          >
            <FilterIcon className="size-4 text-muted-foreground" />
            {t('saveAsSegment')}
          </Button>
        )}

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
                  <MenuItem onSelect={p.onUpdateSelected} disabled={none || p.busy}>
                    {tb('update')}
                  </MenuItem>
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
          <div className="relative">
            <button
              type="button"
              onPointerDown={() => (wasOpen.current = columnsOpen)}
              onClick={() => setColumnsOpen(!wasOpen.current)}
              title={t('columns')}
              aria-label={t('columns')}
              className={iconBtn}
            >
              <ViewWeekOutlinedIcon fontSize="small" />
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
