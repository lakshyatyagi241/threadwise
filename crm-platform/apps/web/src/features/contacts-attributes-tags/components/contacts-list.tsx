'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, cn } from '@crm/ui';
import { isAttrId, type ColumnDef, type ColumnId } from '../lib/columns';
import { formatDmy } from '../lib/format';
import type { CheckState } from '../lib/selection';
import type { RowView } from '../lib/row-view';
import { AttributeChip, ContactAvatar, GroupChip, MoreChip, TagChip } from './chips';
import { PencilIcon, TrashIcon } from './icons';

export interface ListHandlers {
  selected: ReadonlySet<string>;
  canEdit: boolean;
  canDelete: boolean;
  stageLabel: (value: string) => string;
  statusLabel: (value: string) => string;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Tag chips become filter links when the API can filter by tag. */
  onFilterTag?: (tagId: string) => void;
}

/** How many chips a cell shows before collapsing the rest into "+N". */
const CHIPS_SHOWN = 2;

/** Column widths in px; the table is fixed-layout and scrolls sideways inside its card when they do not fit. */
const WIDTH: Record<string, number> = {
  name: 260,
  phone: 170,
  attr: 150,
  email: 240,
  tags: 240,
  groups: 220,
  stage: 170,
  language: 130,
  memo: 220,
  createdOn: 140,
};
const widthOf = (id: ColumnId) => WIDTH[isAttrId(id) ? 'attr' : id] ?? 160;
const SELECT_W = 48;
const ACTIONS_W = 104;

export function tableMinWidth(columns: readonly ColumnDef[]): number {
  return SELECT_W + ACTIONS_W + columns.reduce((sum, c) => sum + widthOf(c.id), 0);
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

function RowActions({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!h.canEdit && !h.canDelete) return null;
  return (
    <div className="inline-flex items-center gap-1 whitespace-nowrap">
      {h.canEdit && (
        <button
          type="button"
          onClick={() => h.onEdit(row.id)}
          title={t('edit')}
          aria-label={t('editNamed', { name: row.name })}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <PencilIcon className="size-3.5" />
        </button>
      )}
      {h.canDelete && (
        <button
          type="button"
          onClick={() => h.onDelete(row.id)}
          title={t('delete')}
          aria-label={t('deleteNamed', { name: row.name })}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-danger outline-none hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-primary"
        >
          <TrashIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!row.stage && !row.status && !row.optedOut) return <Dash />;
  return (
    <div className="flex flex-wrap gap-1">
      {row.stage && <Badge>{h.stageLabel(row.stage)}</Badge>}
      {row.status && <Badge tone="success">{h.statusLabel(row.status)}</Badge>}
      {row.optedOut && <Badge tone="warning">{t('optedOut')}</Badge>}
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

function NameCell({ row }: { row: RowView }) {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ContactAvatar id={row.id} name={row.name} />
      <Link
        href={`/contacts/${row.id}`}
        title={row.name || undefined}
        className="min-w-0 truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {row.name || t('unnamed')}
      </Link>
    </div>
  );
}

function Cell({ column, row, h }: { column: ColumnDef; row: RowView; h: ListHandlers }) {
  const id = column.id;
  if (isAttrId(id)) return <Clip value={row.custom[column.attributeKey ?? ''] ?? ''} />;
  switch (id) {
    case 'name':
      return <NameCell row={row} />;
    case 'phone':
      return <Clip value={row.phone} ltr mono />;
    case 'email':
      return <Clip value={row.email} ltr />;
    case 'tags':
      return <TagsCell row={row} h={h} />;
    case 'groups':
      return <GroupsCell row={row} />;
    case 'stage':
      return <StatusCell row={row} h={h} />;
    case 'language':
      return <Clip value={row.language} />;
    case 'memo':
      return <Clip value={row.memo} />;
    case 'createdOn':
      return <Clip value={formatDmy(row.createdAt)} ltr mono />;
  }
}

export function ContactsTable({
  rows,
  columns,
  headerState,
  onToggleAll,
  ...h
}: {
  rows: RowView[];
  columns: readonly ColumnDef[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
} & ListHandlers) {
  const t = useTranslations('contacts-attributes-tags.list');
  const th = 'px-3 py-3.5 text-start text-sm font-semibold text-foreground';
  const actions = h.canEdit || h.canDelete;
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full table-fixed text-sm"
        style={{ minWidth: tableMinWidth(columns) - (actions ? 0 : ACTIONS_W) }}
      >
        <colgroup>
          <col style={{ width: SELECT_W }} />
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
          {actions && <col style={{ width: ACTIONS_W }} />}
        </colgroup>
        <thead className="bg-muted/50">
          <tr>
            <th className="py-3.5 ps-4 pe-2 text-start">
              <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={cn(th, 'truncate')}>
                {'key' in c.label ? t(c.label.key) : c.label.text}
              </th>
            ))}
            {actions && (
              <th scope="col" className={cn(th, 'pe-4 text-end')}>
                {t('colActions')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSel = h.selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={cn(
                  'h-14 border-t border-border align-middle transition-colors hover:bg-muted/40',
                  isSel && 'bg-brand/5 hover:bg-brand/10',
                )}
              >
                <td className="ps-4 pe-2">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => h.onToggle(row.id)}
                    aria-label={t('selectRow', { name: row.name || t('unnamed') })}
                    className="size-4 cursor-pointer accent-[var(--brand)]"
                  />
                </td>
                {columns.map((c) => (
                  <td key={c.id} className="max-w-0 px-3 py-2">
                    <Cell column={c} row={row} h={h} />
                  </td>
                ))}
                {actions && (
                  <td className="pe-4 ps-3 text-end">
                    <RowActions row={row} h={h} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Card layout of the same rows: the mobile-friendly alternative to the wide table. */
export function ContactsGrid({ rows, ...h }: { rows: RowView[] } & ListHandlers) {
  const t = useTranslations('contacts-attributes-tags.list');
  return (
    <ul className="grid gap-3 p-4 sm:grid-cols-2 min-[1700px]:grid-cols-3">
      {rows.map((row) => {
        const isSel = h.selected.has(row.id);
        return (
          <li
            key={row.id}
            className={cn(
              'flex flex-col gap-3 rounded-lg border border-border p-4',
              isSel && 'border-brand/50 bg-brand/5',
            )}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => h.onToggle(row.id)}
                aria-label={t('selectRow', { name: row.name || t('unnamed') })}
                className="mt-2 size-4 cursor-pointer accent-[var(--brand)]"
              />
              <ContactAvatar id={row.id} name={row.name} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/contacts/${row.id}`}
                  className="block truncate font-semibold hover:text-primary hover:underline"
                >
                  {row.name || t('unnamed')}
                </Link>
                <div className="truncate text-xs text-muted-foreground" dir="ltr">
                  <span className="text-start">{row.email || '-'}</span>
                </div>
                <div className="truncate text-xs tabular-nums" dir="ltr">
                  {row.phone || '-'}
                </div>
              </div>
              <RowActions row={row} h={h} />
            </div>
            <StatusCell row={row} h={h} />
            {row.groups.length > 0 && <GroupsCell row={row} />}
            {row.tags.length > 0 && <TagsCell row={row} h={h} />}
            {row.attributes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {row.attributes.map((a) => (
                  <AttributeChip key={a.key} label={a.label} text={a.text} full={a.full} />
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {t('colCreatedOn')}: <span className="tabular-nums">{formatDmy(row.createdAt) || '-'}</span>
            </div>
            {row.memo && <p className="line-clamp-2 text-xs text-muted-foreground">{row.memo}</p>}
          </li>
        );
      })}
    </ul>
  );
}
