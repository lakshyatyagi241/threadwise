'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, cn } from '@crm/ui';
import type { CheckState } from '../lib/selection';
import type { RowView } from '../lib/row-view';
import { AttributeChip, ContactAvatar, GroupChip, TagPill } from './chips';
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
      className="size-4 accent-[var(--primary)]"
    />
  );
}

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
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
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
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-danger hover:bg-danger/10"
        >
          <TrashIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function StatusCell({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (!row.stage && !row.status && !row.optedOut)
    return <span className="text-muted-foreground">&mdash;</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.stage && <Badge>{h.stageLabel(row.stage)}</Badge>}
      {row.status && <Badge tone="success">{h.statusLabel(row.status)}</Badge>}
      {row.optedOut && <Badge tone="warning">{t('optedOut')}</Badge>}
    </div>
  );
}

function ChipsOf({ row, h }: { row: RowView; h: ListHandlers }) {
  const t = useTranslations('contacts-attributes-tags.list');
  if (row.tags.length === 0) return <span className="text-muted-foreground">&mdash;</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.tags.map((tag) =>
        h.onFilterTag ? (
          <button
            key={tag.id}
            type="button"
            title={t('filterByTag', { name: tag.name })}
            onClick={() => h.onFilterTag?.(tag.id)}
            className="hover:opacity-80"
          >
            <TagPill name={tag.name} color={tag.color} />
          </button>
        ) : (
          <TagPill key={tag.id} name={tag.name} color={tag.color} />
        ),
      )}
    </div>
  );
}

export function ContactsTable({
  rows,
  headerState,
  onToggleAll,
  ...h
}: {
  rows: RowView[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
} & ListHandlers) {
  const t = useTranslations('contacts-attributes-tags.list');
  const th = 'px-3 py-2.5 text-start text-[11px] font-semibold uppercase tracking-wider';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] table-fixed text-sm">
        <colgroup>
          <col className="w-11" />
          <col className="w-60" />
          <col className="w-48" />
          <col className="w-44" />
          <col className="w-52" />
          <col className="w-40" />
          <col className="w-40" />
          <col />
          <col className="w-24" />
        </colgroup>
        <thead className="border-b border-border bg-muted text-muted-foreground">
          <tr>
            <th className="py-2.5 ps-4 pe-2 text-start">
              <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
            </th>
            <th className={th}>{t('colName')}</th>
            <th className={th}>{t('colGroups')}</th>
            <th className={th}>{t('colTags')}</th>
            <th className={th}>{t('colEmail')}</th>
            <th className={th}>{t('colMobile')}</th>
            <th className={th}>{t('colStatus')}</th>
            <th className={th}>{t('colMemo')}</th>
            <th className={cn(th, 'pe-4 text-end')}>{t('colActions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const isSel = h.selected.has(row.id);
            return (
              <tr key={row.id} className={cn('align-middle', isSel && 'bg-primary/5')}>
                <td className="py-2 ps-4 pe-2">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => h.onToggle(row.id)}
                    aria-label={t('selectRow', { name: row.name })}
                    className="size-4 accent-[var(--primary)]"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ContactAvatar id={row.id} name={row.name} />
                    <div className="min-w-0">
                      <Link
                        href={`/contacts/${row.id}`}
                        className="block truncate font-semibold hover:text-primary hover:underline"
                      >
                        {row.name || t('unnamed')}
                      </Link>
                      {row.language && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {row.language}
                        </div>
                      )}
                      {row.attributes.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.attributes.map((a) => (
                            <AttributeChip
                              key={a.key}
                              label={a.label}
                              text={a.text}
                              full={a.full}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {row.groups.length === 0 ? (
                    <span className="text-muted-foreground">&mdash;</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.groups.map((g) => (
                        <GroupChip key={g.id} name={g.name} color={g.color} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ChipsOf row={row} h={h} />
                </td>
                <td className="truncate px-3 py-2 text-[13px]" dir="ltr">
                  <span className="block truncate text-start">
                    {row.email || <span className="text-muted-foreground">&mdash;</span>}
                  </span>
                </td>
                <td className="truncate px-3 py-2 font-mono text-xs" dir="ltr">
                  <span className="block truncate text-start">
                    {row.phone || <span className="text-muted-foreground">&mdash;</span>}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <StatusCell row={row} h={h} />
                </td>
                <td className="truncate px-3 py-2 text-xs text-muted-foreground">{row.memo}</td>
                <td className="py-2 pe-4 ps-3 text-end">
                  <RowActions row={row} h={h} />
                </td>
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
              'flex flex-col gap-3 rounded-md border border-border p-4',
              isSel && 'border-primary/50 bg-primary/5',
            )}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => h.onToggle(row.id)}
                aria-label={t('selectRow', { name: row.name })}
                className="mt-2 size-4 accent-[var(--primary)]"
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
                  <span className="text-start">{row.email}</span>
                </div>
                <div className="truncate font-mono text-xs" dir="ltr">
                  {row.phone}
                </div>
              </div>
              <RowActions row={row} h={h} />
            </div>
            <StatusCell row={row} h={h} />
            {row.groups.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {row.groups.map((g) => (
                  <GroupChip key={g.id} name={g.name} color={g.color} />
                ))}
              </div>
            )}
            {row.tags.length > 0 && <ChipsOf row={row} h={h} />}
            {row.attributes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {row.attributes.map((a) => (
                  <AttributeChip key={a.key} label={a.label} text={a.text} full={a.full} />
                ))}
              </div>
            )}
            {row.memo && <p className="line-clamp-2 text-xs text-muted-foreground">{row.memo}</p>}
          </li>
        );
      })}
    </ul>
  );
}
