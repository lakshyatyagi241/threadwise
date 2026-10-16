'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { FieldResponse } from '@crm/contracts';
import { displayValue } from '@/features/contacts-attributes-tags/lib/field-values';
import type { CompanyResponse } from '../api/schemas';
import { isPropId, type ColumnDef } from '../lib/columns';
import { formatTotals } from '../lib/money';
import type { CheckState } from '../lib/selection';
import { TrashIcon } from './icons';

export interface CompaniesTableProps {
  rows: readonly CompanyResponse[];
  /** The columns drawn, in order (the company column is always first). */
  columns: readonly ColumnDef[];
  /** The workspace's company properties, to show a property column's value the way its type reads. */
  fields: readonly FieldResponse[];
  selected: ReadonlySet<string>;
  headerState: CheckState;
  /** Delete buttons and the selection column show only for someone who may delete. */
  canDelete: boolean;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onDelete: (company: CompanyResponse) => void;
  onOpen: (id: string) => void;
}

/** A figure the caller may not see is a dash, never a zero. */
const count = (n: number | null | undefined, locale: string): string =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat(locale).format(n);

/** The figures are right aligned, the rest start-aligned. */
const NUMERIC = new Set(['contacts', 'openDeals', 'wonValue']);

/**
 * Reference's list (TW-CTP-002): Company, Industry, Contacts, Open deals, Won value, and a delete button on each row. The whole row
 * opens the company; the name is a real link so keyboard and middle-click work. "Columns" adds the company's other details and its
 * properties (BL-196); without a choice the table is Reference's.
 */
export function CompaniesTable(p: CompaniesTableProps) {
  const t = useTranslations('companies.table');
  const tc = useTranslations('companies.common');
  const locale = useLocale();
  const header = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (header.current) header.current.indeterminate = p.headerState === 'some';
  }, [p.headerState]);

  const fieldByKey = new Map(p.fields.map((f) => [f.key, f]));
  const labelOf = (c: ColumnDef) => ('key' in c.label ? t(c.label.key) : c.label.text);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  const cell = (c: ColumnDef, row: CompanyResponse) => {
    if (isPropId(c.id)) {
      const key = c.id.slice('prop:'.length);
      const field = fieldByKey.get(key);
      const raw = row.customFields[key];
      const text = field
        ? displayValue(field, raw, { yes: tc('yes'), no: tc('no') })
        : raw === undefined || raw === null
          ? ''
          : String(raw);
      return text || '—';
    }
    switch (c.id) {
      case 'industry':
        return row.industry || '—';
      case 'website':
        return row.website || '—';
      case 'email':
        return row.email || '—';
      case 'phone':
        return row.phone || '—';
      case 'size':
        return row.sizeRange || '—';
      case 'owner':
        return row.owner?.name || '—';
      case 'created':
        return date(row.createdAt);
      default:
        return null;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border bg-muted/50 text-start text-muted-foreground">
            {p.canDelete && (
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  ref={header}
                  type="checkbox"
                  aria-label={t('selectAll')}
                  checked={p.headerState === 'all'}
                  onChange={(e) => p.onToggleAll(e.target.checked)}
                  className="size-4 cursor-pointer accent-[var(--brand)]"
                />
              </th>
            )}
            {p.columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={`px-4 py-3 font-medium ${NUMERIC.has(c.id) ? 'text-end' : 'text-start'}`}
              >
                {labelOf(c)}
              </th>
            ))}
            <th scope="col" className="w-16 px-4 py-3 text-end font-medium">
              <span className="sr-only">{t('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((c) => {
            const won = formatTotals(c.rollup.deals?.wonValue, locale);
            return (
              <tr
                key={c.id}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                onClick={() => p.onOpen(c.id)}
                data-selected={p.selected.has(c.id) || undefined}
              >
                {p.canDelete && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t('select', { name: c.name })}
                      checked={p.selected.has(c.id)}
                      onChange={() => p.onToggle(c.id)}
                      className="size-4 cursor-pointer accent-[var(--brand)]"
                    />
                  </td>
                )}
                {p.columns.map((col) => {
                  switch (col.id) {
                    case 'company':
                      return (
                        <td key={col.id} className="max-w-xs px-4 py-3 font-semibold">
                          <Link
                            href={`/companies/${c.id}`}
                            dir="auto"
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
                            title={c.name}
                          >
                            {c.name}
                          </Link>
                        </td>
                      );
                    case 'contacts':
                      return (
                        <td key={col.id} className="px-4 py-3 text-end font-mono tabular-nums">
                          {count(c.rollup.contacts, locale)}
                        </td>
                      );
                    case 'openDeals':
                      return (
                        <td key={col.id} className="px-4 py-3 text-end font-mono tabular-nums">
                          {count(c.rollup.deals?.open, locale)}
                        </td>
                      );
                    case 'wonValue':
                      return (
                        <td key={col.id} className="px-4 py-3 text-end font-mono tabular-nums">
                          {c.rollup.deals === null ? (
                            '—'
                          ) : won.length === 0 ? (
                            <span className="text-muted-foreground">{count(0, locale)}</span>
                          ) : (
                            won.map((line) => <div key={line}>{line}</div>)
                          )}
                        </td>
                      );
                    default:
                      return (
                        <td
                          key={col.id}
                          className="max-w-56 truncate px-4 py-3 text-muted-foreground"
                          dir="auto"
                        >
                          {cell(col, c)}
                        </td>
                      );
                  }
                })}
                <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                  {p.canDelete && (
                    <button
                      type="button"
                      title={t('delete')}
                      aria-label={t('deleteNamed', { name: c.name })}
                      onClick={() => p.onDelete(c)}
                      className="inline-grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
