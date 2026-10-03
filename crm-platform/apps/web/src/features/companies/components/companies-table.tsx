'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { CompanyResponse } from '../api/schemas';
import { formatTotals } from '../lib/money';
import type { CheckState } from '../lib/selection';
import { TrashIcon } from './icons';

export interface CompaniesTableProps {
  rows: readonly CompanyResponse[];
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

/**
 * WaDesk's list (WD-CTP-002): Company, Industry, Contacts, Open deals, Won value, and a delete button on each row. The whole row
 * opens the company; the name is a real link so keyboard and middle-click work.
 */
export function CompaniesTable(p: CompaniesTableProps) {
  const t = useTranslations('companies.table');
  const locale = useLocale();
  const header = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (header.current) header.current.indeterminate = p.headerState === 'some';
  }, [p.headerState]);

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
            <th scope="col" className="px-4 py-3 text-start font-medium">
              {t('company')}
            </th>
            <th scope="col" className="px-4 py-3 text-start font-medium">
              {t('industry')}
            </th>
            <th scope="col" className="px-4 py-3 text-end font-medium">
              {t('contacts')}
            </th>
            <th scope="col" className="px-4 py-3 text-end font-medium">
              {t('openDeals')}
            </th>
            <th scope="col" className="px-4 py-3 text-end font-medium">
              {t('wonValue')}
            </th>
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
                <td className="max-w-xs px-4 py-3 font-semibold">
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
                <td className="px-4 py-3 text-muted-foreground" dir="auto">
                  {c.industry || '—'}
                </td>
                <td className="px-4 py-3 text-end font-mono tabular-nums">
                  {count(c.rollup.contacts, locale)}
                </td>
                <td className="px-4 py-3 text-end font-mono tabular-nums">
                  {count(c.rollup.deals?.open, locale)}
                </td>
                <td className="px-4 py-3 text-end font-mono tabular-nums">
                  {c.rollup.deals === null ? (
                    '—'
                  ) : won.length === 0 ? (
                    <span className="text-muted-foreground">{count(0, locale)}</span>
                  ) : (
                    won.map((line) => <div key={line}>{line}</div>)
                  )}
                </td>
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
