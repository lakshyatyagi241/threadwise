'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuSeparator,
  Select,
  cn,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useActivitySettings } from '@/features/sales-activities';
import { useRecordRef, useTaskOutcomes } from '../api/hooks';
import { outcomeChoices } from '../lib/outcomes';
import { PRIORITIES, type Member } from '../api/schemas';
import { COLUMN_IDS, LOCKED_COLUMNS, type ColumnId } from '../lib/columns';
import {
  hasActiveFilter,
  type StatusFilter,
  type TaskFilters,
  type TasksView,
} from '../lib/filters';
import { BoardIcon, ColumnsIcon, KeyboardIcon, ListIcon, RefreshIcon, SearchIcon } from './icons';
import { RecordPicker } from './record-picker';

/** What the "Linked to" filter points at; empty = any record. */
type LinkKind = '' | 'contact' | 'deal' | 'company';

/** The screen focuses the search box by this id when "/" is pressed. */
export const SEARCH_ID = 'tasks-search';

const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

export interface TasksToolbarProps {
  filters: TaskFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<TaskFilters>) => void;
  members: readonly Member[];
  visibleColumns: ReadonlySet<ColumnId>;
  onColumn: (id: ColumnId, on: boolean) => void;
  onResetColumns: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onHelp: () => void;
}

/** One compact row: search, status, priority, assignee, linked contact, deal or company, Clear, then view, columns, refresh. */
export function TasksToolbar(p: TasksToolbarProps) {
  const t = useTranslations('tasks.toolbar');
  const f = p.filters;
  const active = hasActiveFilter({ ...f, q: p.q });
  // "Linked to" first picks a kind, then the record; only the record filters the list.
  const canPickCompany = useCan('record.companies.read');
  const [pending, setPending] = useState<LinkKind>('');
  const linkKind: LinkKind = f.contact
    ? 'contact'
    : f.deal
      ? 'deal'
      : f.company
        ? 'company'
        : pending;
  const linkId =
    linkKind === 'contact'
      ? f.contact
      : linkKind === 'deal'
        ? f.deal
        : linkKind === 'company'
          ? f.company
          : '';
  const outcomes = useTaskOutcomes(false);
  const outcomeSettings = useActivitySettings('task');
  const outcomeOptions = outcomeChoices(
    outcomes.data ?? [],
    f.outcome ? { id: f.outcome, name: '…', isActive: true } : null,
  );
  const showOutcomeFilter = !(outcomeSettings.loaded && !outcomeSettings.outcomesEnabled);
  const ref = useRecordRef(linkKind === '' ? 'contact' : linkKind, linkId);
  const views: Array<{ id: TasksView; icon: typeof ListIcon }> = [
    { id: 'list', icon: ListIcon },
    { id: 'board', icon: BoardIcon },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={SEARCH_ID}
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          aria-keyshortcuts="/"
          className="h-9 ps-9"
        />
      </div>

      {f.tab === 'all' && (
        <Select
          aria-label={t('status')}
          className="h-9 w-auto min-w-32"
          value={f.status}
          onChange={(e) => p.onChange({ status: e.target.value as StatusFilter })}
        >
          <option value="open">{t('statusOpen')}</option>
          <option value="done">{t('statusDone')}</option>
          <option value="all">{t('statusAll')}</option>
        </Select>
      )}

      <Select
        aria-label={t('priority')}
        className="h-9 w-auto min-w-32"
        value={f.priority}
        onChange={(e) => p.onChange({ priority: e.target.value as TaskFilters['priority'] })}
      >
        <option value="">{t('allPriorities')}</option>
        {PRIORITIES.map((x) => (
          <option key={x} value={x}>
            {t(`priorities.${x}`)}
          </option>
        ))}
      </Select>

      {outcomeOptions.length > 0 && showOutcomeFilter && (
        <Select
          aria-label={t('outcome')}
          className="h-9 w-auto min-w-36 max-w-52"
          value={f.outcome}
          onChange={(e) => p.onChange({ outcome: e.target.value })}
        >
          <option value="">{t('allOutcomes')}</option>
          {outcomeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      )}

      {f.tab !== 'mine' && (
        <Select
          aria-label={t('assignee')}
          className="h-9 w-auto min-w-36 max-w-52"
          value={f.assignee}
          onChange={(e) => p.onChange({ assignee: e.target.value })}
        >
          <option value="">{t('allAssignees')}</option>
          <option value="none">{t('unassigned')}</option>
          {p.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </Select>
      )}

      <Select
        aria-label={t('linked')}
        className="h-9 w-auto min-w-36"
        value={linkKind}
        onChange={(e) => {
          setPending(e.target.value as LinkKind);
          p.onChange({ contact: '', deal: '', company: '' });
        }}
      >
        <option value="">{t('anyLink')}</option>
        <option value="contact">{t('linkContact')}</option>
        <option value="deal">{t('linkDeal')}</option>
        {(canPickCompany || linkKind === 'company') && (
          <option value="company">{t('linkCompany')}</option>
        )}
      </Select>
      {linkKind && (
        <RecordPicker
          compact
          kind={linkKind}
          value={linkId ? (ref.data ?? { id: linkId, label: '…' }) : null}
          onChange={(r) => {
            const none = { contact: '', deal: '', company: '' };
            p.onChange({ ...none, [linkKind]: r?.id ?? '' });
          }}
        />
      )}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPending('');
            p.onQ('');
            p.onChange({
              q: '',
              status: 'open',
              priority: '',
              assignee: '',
              contact: '',
              deal: '',
              company: '',
              outcome: '',
            });
          }}
        >
          {t('clear')}
        </Button>
      )}

      <div className="ms-auto flex items-center gap-2">
        <Menu
          label={t('modifyColumns')}
          align="end"
          triggerClassName={cn(iconBtn, 'px-0')}
          triggerProps={{ 'aria-label': t('modifyColumns'), title: t('modifyColumns') }}
          trigger={<ColumnsIcon className="size-4" />}
        >
          {COLUMN_IDS.map((c) => (
            <MenuCheckboxItem
              key={c}
              checked={p.visibleColumns.has(c)}
              disabled={LOCKED_COLUMNS.includes(c)}
              onCheckedChange={(on) => p.onColumn(c, on)}
            >
              {t(`columns.${c}`)}
            </MenuCheckboxItem>
          ))}
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
        <button
          type="button"
          onClick={p.onHelp}
          title={t('shortcuts')}
          aria-label={t('shortcuts')}
          className={cn(iconBtn, 'hidden sm:inline-flex')}
        >
          <KeyboardIcon className="size-4" />
        </button>
        <div
          role="group"
          aria-label={t('view')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {views.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={f.view === id}
              title={t(`views.${id}`)}
              aria-label={t(`views.${id}`)}
              onClick={() => p.onChange({ view: id })}
              className={cn(
                'inline-flex size-9 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                f.view === id ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
              )}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
