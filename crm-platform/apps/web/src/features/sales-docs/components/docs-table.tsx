'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { DocRow } from '../api/schemas';
import { formatDay, formatInstantDay } from '../lib/format';
import { docHref } from '../lib/kinds';
import { formatMoney } from '../lib/money';
import type { CheckState } from '../lib/selection';
import { allowedActions, effectiveStatus, isLapsed, type DocAction } from '../lib/status';
import {
  COLUMN_IDS,
  SELECT_W,
  STICKY_FIRST,
  STICKY_FIRST_HEAD,
  STICKY_SELECT,
  STICKY_SELECT_HEAD,
  WIDTH,
  frozenEdge,
  isScrolledSideways,
  tableMinWidth,
  type ColumnId,
} from '../lib/sticky';
import { DocMenuItems } from './doc-controller';
import { AlertIcon, CalendarIcon, ClockIcon, ContactIcon, DealIcon, UserIcon } from './icons';
import { Avatar, ContactPill, StatusChip } from './parts';
import { RowMenu } from './row-menu';

export interface RowHandlers {
  selected: ReadonlySet<string>;
  /** The row the keyboard is on. */
  activeId: string | null;
  can: {
    update: boolean;
    create: boolean;
    delete: boolean;
    send: boolean;
    convert: boolean;
    order?: boolean;
  };
  today: string;
  zone: string | undefined;
  onToggleSelect: (id: string) => void;
  onOpen: (doc: DocRow) => void;
  onAction: (action: DocAction, doc: DocRow) => void;
}

function HeaderIcon({ id }: { id: ColumnId }) {
  const cls = 'size-3.5 shrink-0 opacity-70';
  switch (id) {
    case 'number':
    case 'title':
      return null;
    case 'contact':
      return <ContactIcon className={cls} />;
    case 'amount':
      return null;
    case 'status':
      return <DealIcon className={cls} />;
    case 'validUntil':
      return <CalendarIcon className={cls} />;
    case 'owner':
      return <UserIcon className={cls} />;
    case 'created':
      return <ClockIcon className={cls} />;
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

/** The "..." menu of one row: open, send, status changes, convert, duplicate, activity, delete. */
export function DocRowMenu({ doc, h }: { doc: DocRow; h: RowHandlers }) {
  const t = useTranslations('sales-docs.row');
  const status = effectiveStatus(doc, h.today);
  const allowed = allowedActions(status, {
    can: h.can,
    hasDeal: doc.deal !== null,
  });
  // Printing needs the paper; the row menu opens the document, which has the button.
  allowed.delete('print');
  return (
    <RowMenu label={t('moreFor', { number: doc.number })}>
      {(close) => (
        <DocMenuItems
          allowed={allowed}
          close={close}
          onOpen={() => h.onOpen(doc)}
          onRun={(a) => h.onAction(a, doc)}
        />
      )}
    </RowMenu>
  );
}

function NumberCell({ doc, h }: { doc: DocRow; h: RowHandlers }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        href={docHref(doc.kind, doc.id)}
        title={doc.number}
        className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {doc.number}
      </Link>
      <DocRowMenu doc={doc} h={h} />
    </div>
  );
}

function Cell({
  id,
  doc,
  h,
  locale,
}: {
  id: ColumnId;
  doc: DocRow;
  h: RowHandlers;
  locale: string;
}) {
  const t = useTranslations('sales-docs.row');
  const status = effectiveStatus(doc, h.today);
  switch (id) {
    case 'number':
      return <NumberCell doc={doc} h={h} />;
    case 'title': {
      const buyer = doc.buyerName || doc.company?.name || '';
      return (
        <div className="min-w-0">
          <div className="truncate font-medium" title={doc.title} dir="auto">
            {doc.title || <span className="text-muted-foreground">{t('untitled')}</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground" dir="auto">
            {buyer || t('noBuyer')}
          </div>
        </div>
      );
    }
    case 'contact':
      return doc.contact ? <ContactPill id={doc.contact.id} name={doc.contact.name} /> : <Dash />;
    case 'amount':
      return (
        <span className="block truncate text-end font-medium tabular-nums" dir="ltr">
          {formatMoney(doc.totalMinor, doc.currency, locale)}
        </span>
      );
    case 'status':
      return <StatusChip status={status} />;
    case 'validUntil': {
      if (!doc.validUntil) return <Dash />;
      const lapsed = isLapsed(doc.validUntil, h.today) && status === 'expired';
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums',
            lapsed && 'font-medium text-warning',
          )}
        >
          {lapsed && <AlertIcon className="size-3.5" />}
          {formatDay(doc.validUntil, locale)}
        </span>
      );
    }
    case 'owner':
      return doc.owner ? (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Avatar name={doc.owner.name} />
          <span className="truncate" title={doc.owner.name}>
            {doc.owner.name}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">{t('unowned')}</span>
      );
    case 'created':
      return (
        <span className="block truncate tabular-nums text-muted-foreground">
          {formatInstantDay(doc.createdAt, locale, h.zone) || '-'}
        </span>
      );
  }
}

export function DocsTable({
  docs,
  headerState,
  onToggleAll,
  ...h
}: {
  docs: readonly DocRow[];
  headerState: CheckState;
  onToggleAll: (checked: boolean) => void;
} & RowHandlers) {
  const t = useTranslations('sales-docs.table');
  const locale = useLocale();
  // The shadow along the frozen edge shows only once something has scrolled underneath it.
  const [scrolled, setScrolled] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Keep the keyboard's row in view.
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
        style={{ minWidth: tableMinWidth() }}
      >
        <colgroup>
          <col style={{ width: SELECT_W }} />
          {COLUMN_IDS.map((c) => (
            <col key={c} style={{ width: WIDTH[c] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={cn(th, 'py-3 ps-4 pe-2', STICKY_SELECT_HEAD)}>
              <HeaderCheckbox state={headerState} onChange={onToggleAll} label={t('selectAll')} />
            </th>
            {COLUMN_IDS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  c === 'number' && `${STICKY_FIRST_HEAD} ${frozenEdge(scrolled)}`,
                  c === 'amount' && 'text-end',
                )}
              >
                <span
                  className={cn(
                    'flex min-w-0 items-center gap-1.5',
                    c === 'amount' && 'justify-end',
                  )}
                >
                  <HeaderIcon id={c} />
                  <span className="truncate">{t(`columns.${c}`)}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => {
            const isSel = h.selected.has(doc.id);
            return (
              <tr
                key={doc.id}
                data-row-id={doc.id}
                data-selected={isSel}
                data-active={h.activeId === doc.id}
                className={cn(
                  'group h-14 align-middle transition-colors hover:bg-muted data-[active=true]:bg-muted',
                  isSel && 'bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]',
                )}
              >
                <td className={cn('border-b border-border ps-4 pe-2', STICKY_SELECT)}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => h.onToggleSelect(doc.id)}
                    aria-label={t('selectRow', { number: doc.number })}
                    className="size-4 cursor-pointer accent-[var(--brand)]"
                  />
                </td>
                {COLUMN_IDS.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'max-w-0 border-b border-border px-3 py-2',
                      c === 'number' && `${STICKY_FIRST} ${frozenEdge(scrolled)}`,
                    )}
                  >
                    <Cell id={c} doc={doc} h={h} locale={locale} />
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
