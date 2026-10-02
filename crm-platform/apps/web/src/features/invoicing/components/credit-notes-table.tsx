'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CreditNoteSummary } from '@crm/contracts';
import { cn, MenuItem, MenuSeparator } from '@crm/ui';
import { creditNotePdfPath } from '../api/service';
import { formatDay } from '../lib/dates';
import { big, creditNoteActions, num } from '../lib/credit-notes';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import {
  BanIcon,
  CheckIcon,
  DownloadIcon,
  EyeIcon,
  PencilIcon,
  PrinterIcon,
  TrashIcon,
} from './icons';
import {
  creditNoteEditHref,
  creditNoteHref,
  CreditStatusChip,
  ReasonChip,
  SettlementChip,
  type CreditDialogKind,
} from './credit-notes-parts';
import { Money, useInvoicingCan } from './parts';
import { RowMenu } from './row-menu';

export const CREDIT_COLUMNS = [
  'number',
  'invoice',
  'buyer',
  'reason',
  'settlement',
  'total',
  'applied',
  'refunded',
  'issued',
  'status',
] as const;
type Column = (typeof CREDIT_COLUMNS)[number];

/** Column widths in px (fixed layout: the table scrolls sideways inside its card when they do not fit). */
const WIDTHS: Record<Column, number> = {
  number: 210,
  invoice: 140,
  buyer: 160,
  reason: 140,
  settlement: 140,
  total: 110,
  applied: 130,
  refunded: 130,
  issued: 120,
  status: 110,
};
const MIN_WIDTH = CREDIT_COLUMNS.reduce((sum, c) => sum + WIDTHS[c], 0);
const NUMERIC: ReadonlySet<Column> = new Set(['total', 'applied', 'refunded']);

const minorOf = (s: string, currency: string) => num(big(s, currency));

/** The "..." menu of one credit note: only what its state and the person's permissions allow. */
export function CreditNoteRowMenu({
  note,
  onDialog,
}: {
  note: CreditNoteSummary;
  onDialog: (kind: CreditDialogKind, note: CreditNoteSummary) => void;
}) {
  const t = useTranslations('invoicing.creditNotes.row');
  const router = useRouter();
  const can = useInvoicingCan();
  const allowed = creditNoteActions(
    { status: note.status, refundedMinor: minorOf(note.refunded, note.currency) },
    can,
  );
  return (
    <RowMenu label={t('moreFor', { name: note.number ?? t('draft') })}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuItem onSelect={run(() => router.push(creditNoteHref(note.id)))}>
              <EyeIcon /> {t('open')}
            </MenuItem>
            {allowed.has('edit') && (
              <MenuItem onSelect={run(() => router.push(creditNoteEditHref(note.id)))}>
                <PencilIcon /> {t('edit')}
              </MenuItem>
            )}
            {allowed.has('issue') && (
              <MenuItem onSelect={run(() => onDialog('issue', note))}>
                <CheckIcon /> {t('issue')}
              </MenuItem>
            )}
            {allowed.has('pdf') && (
              <MenuItem
                onSelect={run(() => window.open(creditNotePdfPath(note.id), '_blank', 'noopener'))}
              >
                <DownloadIcon /> {t('pdf')}
              </MenuItem>
            )}
            <MenuItem onSelect={run(() => router.push(`${creditNoteHref(note.id)}?print=1`))}>
              <PrinterIcon /> {t('print')}
            </MenuItem>
            {(allowed.has('void') || allowed.has('delete')) && <MenuSeparator />}
            {allowed.has('void') && (
              <MenuItem danger onSelect={run(() => onDialog('void', note))}>
                <BanIcon /> {t('void')}
              </MenuItem>
            )}
            {allowed.has('delete') && (
              <MenuItem danger onSelect={run(() => onDialog('delete', note))}>
                <TrashIcon /> {t('delete')}
              </MenuItem>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}

function Cell({ id, note, locale }: { id: Column; note: CreditNoteSummary; locale: string }) {
  const t = useTranslations('invoicing.creditNotes.table');
  switch (id) {
    case 'number':
      return (
        <Link
          dir="ltr"
          href={creditNoteHref(note.id)}
          title={note.number ?? t('draft')}
          className={cn(
            'block truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary',
            !note.number && 'italic text-muted-foreground',
          )}
        >
          <span dir="ltr">{note.number ?? t('draft')}</span>
        </Link>
      );
    case 'invoice':
      return (
        <Link
          dir="ltr"
          href={`/invoices/${note.invoice.id}`}
          title={note.invoice.number ?? t('draft')}
          className="block truncate text-primary outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span dir="ltr">{note.invoice.number ?? t('draft')}</span>
        </Link>
      );
    case 'buyer':
      return note.buyerName ? (
        <span className="block truncate" dir="auto" title={note.buyerName}>
          {note.buyerName}
        </span>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    case 'reason':
      return <ReasonChip reason={note.reason} />;
    case 'settlement':
      return <SettlementChip settlement={note.settlement} />;
    case 'total':
      return (
        <Money
          minor={minorOf(note.total, note.currency)}
          currency={note.currency}
          className="font-medium"
        />
      );
    case 'applied':
      return note.status !== 'issued' ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <Money minor={minorOf(note.applied, note.currency)} currency={note.currency} />
      );
    case 'refunded': {
      const m = minorOf(note.refunded, note.currency);
      return note.status !== 'issued' || m === 0 ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <Money minor={m} currency={note.currency} className="text-brand dark:text-primary" />
      );
    }
    case 'issued':
      return (
        <span className="tabular-nums text-muted-foreground">
          {formatDay(note.issueDate, locale) || '-'}
        </span>
      );
    case 'status':
      return <CreditStatusChip status={note.status} />;
  }
}

/**
 * The credit notes as a table: the number is frozen, the rest scrolls sideways inside the card (never the page), the header
 * sticks while the rows scroll.
 */
export function CreditNotesTable({
  notes,
  onDialog,
}: {
  notes: readonly CreditNoteSummary[];
  onDialog: (kind: CreditDialogKind, note: CreditNoteSummary) => void;
}) {
  const t = useTranslations('invoicing.creditNotes.table');
  const locale = useLocale();
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
        style={{ minWidth: MIN_WIDTH }}
      >
        <colgroup>
          {CREDIT_COLUMNS.map((c) => (
            <col key={c} style={{ width: WIDTHS[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {CREDIT_COLUMNS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  NUMERIC.has(c) && 'text-end',
                  c === 'number' && `ps-4 ${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`,
                )}
              >
                <span className="block truncate">{t(`columns.${c}`)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => (
            <tr
              key={n.id}
              data-row-id={n.id}
              className="group h-14 align-middle transition-colors hover:bg-muted"
            >
              {CREDIT_COLUMNS.map((c) => (
                <td
                  key={c}
                  className={cn(
                    'max-w-0 border-b border-border px-3 py-2',
                    NUMERIC.has(c) && 'text-end',
                    c === 'number' && `ps-4 ${STICKY_ONLY} ${frozenEdge(scrolled)}`,
                  )}
                >
                  {c === 'number' ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <Cell id={c} note={n} locale={locale} />
                      </div>
                      <CreditNoteRowMenu note={n} onDialog={onDialog} />
                    </div>
                  ) : (
                    <Cell id={c} note={n} locale={locale} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
