'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { InvoiceSummary } from '@crm/contracts';
import { formatDay } from '../lib/dates';
import { rowBalanceMinor } from '../lib/invoice-facts';
import type { CheckState } from '../lib/selection';
import { invoiceMinor } from '../lib/wire';
import {
  frozenEdge,
  INVOICE_COLUMNS,
  isScrolledSideways,
  SELECT_W,
  STICKY_FIRST,
  STICKY_FIRST_HEAD,
  STICKY_SELECT,
  STICKY_SELECT_HEAD,
  tableMinWidth,
  WIDTH,
  type InvoiceColumn,
} from '../lib/sticky';
import { InvoiceRowMenu, invoiceHref } from './invoice-menu';
import { ContactPill, Money, StatusChip } from './parts';
import type { DialogKind } from './use-invoice-dialogs';

export interface InvoiceRowHandlers {
  selected: ReadonlySet<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onDialog: (kind: DialogKind, inv: InvoiceSummary) => void;
  onDuplicated: (inv: { id: string }) => void;
}

/** The checkbox that selects every loaded row; `some` shows the mixed state. */
export function HeaderCheckbox({
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

const NUMERIC: ReadonlySet<InvoiceColumn> = new Set(['total', 'paid', 'balance']);

function Cell({
  id,
  inv,
  h,
  locale,
}: {
  id: InvoiceColumn;
  inv: InvoiceSummary;
  h: InvoiceRowHandlers;
  locale: string;
}) {
  const t = useTranslations('invoicing.table');
  const m = invoiceMinor(inv);
  const shown = inv.status;
  switch (id) {
    case 'number':
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={invoiceHref(inv.id)}
            dir="ltr"
            title={inv.number ?? t('draft')}
            className={cn(
              'min-w-0 flex-1 truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary',
              !inv.number && 'italic text-muted-foreground',
            )}
          >
            <span dir="ltr">{inv.number ?? t('draft')}</span>
          </Link>
          <InvoiceRowMenu invoice={inv} onDialog={h.onDialog} onDuplicated={h.onDuplicated} />
        </div>
      );
    case 'contact': {
      const name = inv.buyerName ?? inv.contact?.name ?? null;
      return inv.contact ? (
        <ContactPill contact={{ id: inv.contact.id, name }} />
      ) : name ? (
        <span className="block truncate" dir="auto" title={name}>
          {name}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    }
    case 'issued':
      return (
        <span className="tabular-nums text-muted-foreground">
          {formatDay(inv.issueDate, locale) || '-'}
        </span>
      );
    case 'due': {
      const late = shown === 'overdue' ? (inv.daysOverdue ?? 0) : 0;
      return (
        <span
          className={cn(
            'tabular-nums',
            late > 0 ? 'font-medium text-danger' : 'text-muted-foreground',
          )}
        >
          {formatDay(inv.dueDate, locale) || '-'}
          {late > 0 && <span className="ms-1.5 text-xs">{t('daysLate', { count: late })}</span>}
        </span>
      );
    }
    case 'total':
      return <Money minor={m.total} currency={inv.currency} />;
    case 'paid':
      return shown === 'draft' || shown === 'void' ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <Money
          minor={m.paid}
          currency={inv.currency}
          className={m.paid > 0 ? 'text-success' : 'text-muted-foreground'}
        />
      );
    case 'balance': {
      const balance = rowBalanceMinor(inv);
      return balance === null ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <Money
          minor={balance}
          currency={inv.currency}
          className={cn(
            'font-semibold',
            (balance === 0 || shown === 'draft') && 'font-normal text-muted-foreground',
          )}
        />
      );
    }
    case 'status':
      return <StatusChip status={shown} />;
  }
}

export function InvoicesTable({
  invoices,
  headerState,
  onToggleAll,
  ...h
}: {
  invoices: readonly InvoiceSummary[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
} & InvoiceRowHandlers) {
  const t = useTranslations('invoicing.table');
  const locale = useLocale();
  // The shadow along the frozen edge shows only once something has scrolled underneath it.
  const [scrolled, setScrolled] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!h.activeId) return;
    box.current
      ?.querySelector<HTMLElement>(`[data-row-id="${h.activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [h.activeId]);

  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  return (
    <div
      ref={box}
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: tableMinWidth(INVOICE_COLUMNS) }}
      >
        <colgroup>
          <col style={{ width: SELECT_W }} />
          {INVOICE_COLUMNS.map((c) => (
            <col key={c} style={{ width: WIDTH[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={cn(th, 'py-3 ps-4 pe-2', STICKY_SELECT_HEAD)}>
              <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
            </th>
            {INVOICE_COLUMNS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  NUMERIC.has(c) && 'text-end',
                  c === 'number' && `${STICKY_FIRST_HEAD} ${frozenEdge(scrolled)}`,
                )}
              >
                <span className="block truncate">{t(`columns.${c}`)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const isSel = h.selected.has(inv.id);
            return (
              <tr
                key={inv.id}
                data-row-id={inv.id}
                data-selected={isSel}
                data-active={h.activeId === inv.id}
                className={cn(
                  'group h-14 align-middle transition-colors hover:bg-muted data-[active=true]:bg-muted',
                  isSel && 'bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]',
                )}
              >
                <td className={cn('border-b border-border ps-4 pe-2', STICKY_SELECT)}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => h.onToggleSelect(inv.id)}
                    aria-label={t('selectRow', { name: inv.number ?? t('draft') })}
                    className="size-4 cursor-pointer accent-[var(--brand)]"
                  />
                </td>
                {INVOICE_COLUMNS.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'max-w-0 border-b border-border px-3 py-2',
                      NUMERIC.has(c) && 'text-end',
                      c === 'number' && `${STICKY_FIRST} ${frozenEdge(scrolled)}`,
                    )}
                  >
                    <Cell id={c} inv={inv} h={h} locale={locale} />
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
