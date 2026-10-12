'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Fragment, useState, type ReactNode } from 'react';
import { MenuItem, MenuSeparator, cn } from '@crm/ui';
import { ScoreBadge, SparkleIcon } from '@/features/lead-scoring';
import { isAttrId, sortKeyOf, type ColumnDef, type ColumnId } from '../lib/columns';
import { formatDateTime } from '../lib/format';
import type { Choice } from '../lib/option-sets';
import { menuActions, quickActions } from '../lib/row-actions';
import type { CheckState } from '../lib/selection';
import type { RowView } from '../lib/row-view';
import {
  frozenEdge,
  isScrolledSideways,
  SELECT_W,
  STICKY_NAME,
  STICKY_NAME_ALONE,
  STICKY_NAME_ALONE_HEAD,
  STICKY_NAME_HEAD,
  STICKY_SELECT,
  STICKY_SELECT_HEAD,
} from '../lib/sticky';
import { ContactAvatar, GroupChip, MoreChip, OutlineTag, TagChip } from './chips';
import {
  CalendarIcon,
  EyeIcon,
  FlagIcon,
  GlobeIcon,
  HashIcon,
  MailIcon,
  NoteIcon,
  PencilIcon,
  PhoneIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
  UsersPlusIcon,
  WhatsAppIcon,
} from './icons';
import { RowMenu } from './row-menu';
import { StageMenu } from './stage-menu';

export interface ListHandlers {
  selected: ReadonlySet<string>;
  canEdit: boolean;
  canDelete: boolean;
  stageLabel: (value: string) => string;
  /** The workspace's stages in order, for the stage cell's menu. */
  stageChoices?: readonly Choice[];
  /** Present when the person may edit contacts: the stage cell then opens a menu that calls this. */
  onStageChange?: (id: string, stage: string) => void;
  /** Id of the contact whose stage is being saved. */
  stageBusyId?: string | null;
  /** What moving a contact holding `status` to `stage` does to its status ("Status becomes X"); null = nothing. */
  stageStatusHint?: (status: string, stage: string) => string | null;
  statusLabel: (value: string) => string;
  onToggle: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Open the group picker for this one contact. */
  onAddToGroup: (id: string) => void;
  /** Open the tag picker for this one contact. */
  onTag: (id: string) => void;
  /** Tag chips become filter links when the API can filter by tag. */
  onFilterTag?: (tagId: string) => void;
}

/** How many chips a cell shows before collapsing the rest into "+N". */
const CHIPS_SHOWN = 2;

/** Column widths in px; the table is fixed-layout and scrolls sideways inside its card when they do not fit. */
const WIDTH: Record<string, number> = {
  name: 340,
  phone: 190,
  attr: 150,
  email: 260,
  tags: 240,
  groups: 220,
  stage: 180,
  leadScore: 130,
  language: 130,
  memo: 220,
  createdOn: 190,
};
const widthOf = (id: ColumnId) => WIDTH[isAttrId(id) ? 'attr' : id] ?? 160;

export function tableMinWidth(columns: readonly ColumnDef[], selectable = true): number {
  return (selectable ? SELECT_W : 0) + columns.reduce((sum, c) => sum + widthOf(c.id), 0);
}

/** Leading icon of a column header, by the kind of data the column holds. */
function HeaderIcon({ id }: { id: ColumnId }) {
  const cls = 'size-3.5 shrink-0 opacity-70';
  if (isAttrId(id)) return <HashIcon className={cls} />;
  switch (id) {
    case 'name':
      return <UserIcon className={cls} />;
    case 'phone':
      return <PhoneIcon className={cls} />;
    case 'email':
      return <MailIcon className={cls} />;
    case 'tags':
      return <TagIcon className={cls} />;
    case 'groups':
      return <UsersIcon className={cls} />;
    case 'stage':
      return <FlagIcon className={cls} />;
    case 'status':
      return <FlagIcon className={cls} />;
    case 'leadScore':
      return <SparkleIcon className={cls} />;
    case 'language':
      return <GlobeIcon className={cls} />;
    case 'memo':
      return <NoteIcon className={cls} />;
    case 'createdOn':
      return <CalendarIcon className={cls} />;
  }
}

/** The checkbox that selects every loaded row; `some` shows the mixed state. */
function HeaderCheckbox({
  state,
  onChange,
  label,
}: {
  state: CheckState;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = state === 'some';
      }}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-pointer accent-[var(--brand)]"
    />
  );
}

const Dash = () => <span className="text-muted-foreground">-</span>;

const quickBtn =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-primary';
const quickOn = 'text-muted-foreground hover:bg-muted hover:text-foreground';
const quickOff = 'cursor-not-allowed text-muted-foreground/40';

/** One round icon button: a link while there is somewhere to go, a disabled button when there is not. */
function QuickLink({
  href,
  label,
  missing,
  color,
  external,
  children,
}: {
  href: string | null;
  label: string;
  /** Tooltip while disabled. */
  missing: string;
  color?: string;
  external?: boolean;
  children: ReactNode;
}) {
  if (!href) {
    return (
      <button
        type="button"
        disabled
        title={missing}
        aria-label={missing}
        className={cn(quickBtn, quickOff)}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={href}
      title={label}
      aria-label={label}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(quickBtn, quickOn, color)}
    >
      {children}
    </a>
  );
}

/**
 * The compact cluster beside a contact's name: call, WhatsApp, email and the "..." menu (view, edit, add to group,
 * tag, delete). Calling, WhatsApp and email are disabled, not hidden, when the contact has no number or address.
 */
function QuickActions({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  const links = quickActions(row);
  const name = row.name || t('unnamed');
  const items = menuActions({ edit: h.canEdit, delete: h.canDelete });
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <QuickLink href={links.call} label={t('callNamed', { name })} missing={t('noPhone')}>
        <PhoneIcon className="size-4" />
      </QuickLink>
      <QuickLink
        href={links.whatsapp}
        label={t('whatsappNamed', { name })}
        missing={t('noWhatsapp')}
        color="text-[#16a34a] hover:text-[#15803d] dark:text-[#4ade80]"
        external
      >
        <WhatsAppIcon className="size-4" />
      </QuickLink>
      <QuickLink href={links.email} label={t('emailNamed', { name })} missing={t('noEmail')}>
        <MailIcon className="size-4" />
      </QuickLink>
      <RowMenu label={t('moreFor', { name })}>
        {(close) => (
          <>
            {items.map((a) => {
              const run = (fn: (id: string) => void) => () => {
                close();
                fn(row.id);
              };
              switch (a) {
                case 'view':
                  return (
                    <MenuItem key={a} onSelect={run(h.onView)}>
                      <EyeIcon /> {t('view')}
                    </MenuItem>
                  );
                case 'edit':
                  return (
                    <MenuItem key={a} onSelect={run(h.onEdit)}>
                      <PencilIcon /> {t('edit')}
                    </MenuItem>
                  );
                case 'group':
                  return (
                    <MenuItem key={a} onSelect={run(h.onAddToGroup)}>
                      <UsersPlusIcon /> {t('addToGroup')}
                    </MenuItem>
                  );
                case 'tag':
                  return (
                    <MenuItem key={a} onSelect={run(h.onTag)}>
                      <TagIcon /> {t('tag')}
                    </MenuItem>
                  );
                case 'delete':
                  return (
                    <Fragment key={a}>
                      <MenuSeparator />
                      <MenuItem danger onSelect={run(h.onDelete)}>
                        <TrashIcon /> {t('delete')}
                      </MenuItem>
                    </Fragment>
                  );
              }
            })}
          </>
        )}
      </RowMenu>
    </div>
  );
}

/** The contact's status as a pill (its own column; the grid card shows it next to the stage). */
function StatusChip({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="inline-flex max-w-full items-center rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
    >
      <span className="truncate">{value}</span>
    </span>
  );
}

function StatusCell({
  row,
  h,
  showStatus = true,
}: {
  row: RowView;
  h: ListHandlers;
  showStatus?: boolean;
}) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!row.stage && !(showStatus && row.status) && !row.optedOut) return <Dash />;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {row.stage && (
        <StageMenu
          value={row.stage}
          choices={h.stageChoices ?? []}
          label={h.stageLabel(row.stage)}
          name={row.name || t('unnamed')}
          busy={h.stageBusyId === row.id}
          onChange={h.onStageChange ? (v) => h.onStageChange?.(row.id, v) : undefined}
          statusHint={
            h.stageStatusHint
              ? (stage) => h.stageStatusHint?.(row.status, stage) ?? null
              : undefined
          }
        />
      )}
      {showStatus && row.status && <StatusChip value={h.statusLabel(row.status)} />}
      {row.optedOut && (
        <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
          {t('optedOut')}
        </span>
      )}
    </div>
  );
}

function TagsCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (row.tags.length === 0) return <Dash />;
  const shown = row.tags.slice(0, CHIPS_SHOWN);
  const rest = row.tags.slice(CHIPS_SHOWN);
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map((tag) =>
        h.onFilterTag ? (
          <button
            key={tag.id}
            type="button"
            title={t('filterByTag', { name: tag.name })}
            onClick={() => h.onFilterTag?.(tag.id)}
            className="min-w-0 rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <TagChip name={tag.name} color={tag.color} />
          </button>
        ) : (
          <TagChip key={tag.id} name={tag.name} color={tag.color} />
        ),
      )}
      {rest.length > 0 && (
        <MoreChip count={rest.length} title={rest.map((x) => x.name).join(', ')} />
      )}
    </div>
  );
}

function GroupsCell({ row }: { row: RowView }) {
  if (row.groups.length === 0) return <Dash />;
  // Group chips carry a name and a dot, so only one fits the column.
  const rest = row.groups.slice(1);
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {row.groups.slice(0, 1).map((g) => (
        <GroupChip key={g.id} name={g.name} color={g.color} />
      ))}
      {rest.length > 0 && (
        <MoreChip count={rest.length} title={rest.map((x) => x.name).join(', ')} />
      )}
    </div>
  );
}

/** Text that ends in an ellipsis, with the full value on hover; "-" when there is none. */
function Clip({ value, ltr, mono }: { value: string; ltr?: boolean; mono?: boolean }) {
  if (!value) return <Dash />;
  return (
    <span
      title={value}
      dir={ltr ? 'ltr' : undefined}
      className={cn('block truncate text-start', mono && 'tabular-nums')}
    >
      {value}
    </span>
  );
}

/** A rounded outlined pill with a small leading icon; the value truncates and the full text is the tooltip. */
function Pill({ value, icon }: { value: string; icon: ReactNode }) {
  if (!value) return <Dash />;
  return (
    <span
      title={value}
      dir="ltr"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs tabular-nums"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

function NameCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch">
        <ContactAvatar id={row.id} name={row.name} className="hidden sm:inline-flex" />
        <Link
          href={`/contacts/${row.id}`}
          title={row.name || undefined}
          className="min-w-0 truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {row.name || t('unnamed')}
        </Link>
      </div>
      <QuickActions row={row} h={h} />
    </div>
  );
}

function Cell({
  column,
  row,
  h,
  locale,
  timeZone,
}: {
  column: ColumnDef;
  row: RowView;
  h: ListHandlers;
  locale: string;
  timeZone: string | undefined;
}) {
  const id = column.id;
  if (isAttrId(id)) return <Clip value={row.custom[column.attributeKey ?? ''] ?? ''} />;
  switch (id) {
    case 'name':
      return <NameCell row={row} h={h} />;
    case 'phone':
      return <Pill value={row.phone} icon={<PhoneIcon className="size-3" />} />;
    case 'email':
      return <Pill value={row.email} icon={<MailIcon className="size-3" />} />;
    case 'tags':
      return <TagsCell row={row} h={h} />;
    case 'groups':
      return <GroupsCell row={row} />;
    case 'stage':
      return <StatusCell row={row} h={h} showStatus={false} />;
    case 'status':
      return row.status ? <StatusChip value={h.statusLabel(row.status)} /> : <Dash />;
    case 'leadScore':
      return row.leadScore === null ? (
        <Dash />
      ) : (
        <ScoreBadge
          score={row.leadScore}
          source={row.leadScoreSource}
          scoredAt={row.leadScoredAt}
        />
      );
    case 'language':
      return row.language ? <OutlineTag value={row.language} /> : <Dash />;
    case 'memo':
      return <Clip value={row.memo} />;
    case 'createdOn':
      return <Clip value={formatDateTime(row.createdAt, locale, timeZone)} mono />;
  }
}

export interface TableSort {
  /** The API sort in force (`createdAt` when nothing was chosen). */
  key: string;
  order: 'asc' | 'desc';
}

function SortArrow({ order, active }: { order: 'asc' | 'desc'; active: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn(
        'size-3 shrink-0 transition',
        active ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-40',
      )}
    >
      <path d={order === 'asc' ? 'M8 3l4 5H4z' : 'M8 13L4 8h8z'} fill="currentColor" />
    </svg>
  );
}

export function ContactsTable({
  rows,
  columns,
  headerState,
  onToggleAll,
  selectable = true,
  sort,
  onSort,
  onMoveColumn,
  onNudgeColumn,
  ...h
}: {
  rows: RowView[];
  columns: readonly ColumnDef[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
  /** False for a read-only listing (the members of a segment): no checkbox column, the name column is frozen alone. */
  selectable?: boolean;
  /** With `onSort`, column headers sort the list (not on a read-only listing or a column with many values). */
  sort?: TableSort;
  onSort?: (key: string) => void;
  /** With these, headers can be dragged (or moved with Alt + arrow keys) to rearrange the columns. */
  onMoveColumn?: (id: ColumnId, target: ColumnId) => void;
  onNudgeColumn?: (id: ColumnId, step: -1 | 1) => void;
} & ListHandlers) {
  const t = useTranslations('contacts-attributes-tags.list');
  const [dragging, setDragging] = useState<ColumnId | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);
  const locale = useLocale();
  const timeZone = useTimeZone();
  // The shadow along the frozen edge shows only once something has scrolled underneath it.
  const [scrolled, setScrolled] = useState(false);
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: tableMinWidth(columns, selectable) }}
      >
        <colgroup>
          {selectable && <col style={{ width: SELECT_W }} />}
          {columns.map((c) => (
            <col
              key={c.id}
              className={c.id === 'name' ? 'w-[200px] sm:w-[340px]' : undefined}
              style={c.id === 'name' ? undefined : { width: widthOf(c.id) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th className={cn(th, 'py-3 ps-4 pe-2', STICKY_SELECT_HEAD)}>
                <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
              </th>
            )}
            {columns.map((c) => {
              const label = 'key' in c.label ? t(c.label.key) : c.label.text;
              const key = onSort ? sortKeyOf(c.id) : null;
              const active = key !== null && sort?.key === key;
              const movable = !!onMoveColumn && c.id !== 'name';
              const heading = (
                <span className="flex min-w-0 items-center gap-1.5">
                  <HeaderIcon id={c.id} />
                  <span className="truncate">{label}</span>
                  {key !== null && (
                    <SortArrow order={active ? sort!.order : 'asc'} active={active} />
                  )}
                </span>
              );
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    active ? (sort!.order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  draggable={movable}
                  onDragStart={
                    movable
                      ? (e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', c.id);
                          setDragging(c.id);
                        }
                      : undefined
                  }
                  onDragOver={
                    dragging && c.id !== 'name' && c.id !== dragging
                      ? (e) => {
                          e.preventDefault();
                          setOver(c.id);
                        }
                      : undefined
                  }
                  onDrop={
                    dragging
                      ? (e) => {
                          e.preventDefault();
                          if (c.id !== 'name' && c.id !== dragging) onMoveColumn?.(dragging, c.id);
                          setDragging(null);
                          setOver(null);
                        }
                      : undefined
                  }
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={cn(
                    th,
                    'group/th',
                    movable && 'cursor-grab',
                    dragging === c.id && 'opacity-50',
                    over === c.id && 'bg-brand/10',
                    c.id === 'name' &&
                      `${selectable ? STICKY_NAME_HEAD : STICKY_NAME_ALONE_HEAD} ${frozenEdge(scrolled)}`,
                  )}
                >
                  {key !== null ? (
                    <button
                      type="button"
                      onClick={() => onSort?.(key)}
                      onKeyDown={(e) => {
                        if (!movable || !e.altKey) return;
                        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                        if (!step) return;
                        // In a right-to-left page the arrows point the other way round.
                        const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                        e.preventDefault();
                        onNudgeColumn?.(c.id, (rtl ? -step : step) as -1 | 1);
                      }}
                      title={t('sortBy', { column: label })}
                      className="flex w-full min-w-0 items-center rounded text-start uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {heading}
                    </button>
                  ) : (
                    heading
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = h.selected.has(row.id);
            return (
              <tr
                key={row.id}
                data-selected={isSel}
                className={cn(
                  'group h-16 align-middle transition-colors hover:bg-muted',
                  isSel && 'bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]',
                )}
              >
                {selectable && (
                  <td className={cn('border-b border-border ps-4 pe-2', STICKY_SELECT)}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => h.onToggle(row.id)}
                      aria-label={t('selectRow', { name: row.name || t('unnamed') })}
                      className="size-4 cursor-pointer accent-[var(--brand)]"
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'max-w-0 border-b border-border px-3 py-2',
                      c.id === 'name' &&
                        `${selectable ? STICKY_NAME : STICKY_NAME_ALONE} ${frozenEdge(scrolled)}`,
                    )}
                  >
                    <Cell column={c} row={row} h={h} locale={locale} timeZone={timeZone} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
