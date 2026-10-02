'use client';

import { INVOICE_DOC_TYPES } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Checkbox, Input, Select, Spinner } from '@crm/ui';
import { useContactName } from '../api/hooks';
import { ORDERS, orderedWindow, type InvoiceFilters } from '../lib/filters';
import { ContactPicker } from './contact-picker';
import { RefreshIcon, SearchIcon } from './icons';

export const SEARCH_ID = 'invoices-search';

/** A three-letter currency code: applied once it is complete (or emptied), so half a code never reaches the API. */
function CurrencyBox({ value, onApply }: { value: string; onApply: (code: string) => void }) {
  const t = useTranslations('invoicing.toolbar');
  const [text, setText] = useState(value);
  return (
    <Input
      value={text}
      maxLength={3}
      dir="ltr"
      placeholder={t('currencyPlaceholder')}
      aria-label={t('currency')}
      className="w-24 uppercase"
      onChange={(e) => {
        const next = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
        setText(next);
        if (next === '' || next.length === 3) onApply(next);
      }}
    />
  );
}

/** Search, contact, issued and due windows, document type, currency, "mine", order and refresh. Every change goes to the address. */
export function InvoicesToolbar({
  filters,
  q,
  onQ,
  onChange,
  onRefresh,
  refreshing,
  filtered,
  onReset,
}: {
  filters: InvoiceFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<InvoiceFilters>) => void;
  onRefresh: () => void;
  refreshing: boolean;
  filtered: boolean;
  onReset: () => void;
}) {
  const t = useTranslations('invoicing.toolbar');
  const name = useContactName(filters.contact);

  const setIssued = (patch: { from?: string; to?: string }) => {
    const w = orderedWindow(patch.from ?? filters.issuedFrom, patch.to ?? filters.issuedTo);
    onChange({ issuedFrom: w.from, issuedTo: w.to });
  };
  const setDue = (patch: { from?: string; to?: string }) => {
    const w = orderedWindow(patch.from ?? filters.dueFrom, patch.to ?? filters.dueTo);
    onChange({ dueFrom: w.from, dueTo: w.to });
  };

  const date = 'w-36 sm:w-40';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={SEARCH_ID}
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="ps-9"
          />
        </div>
        <ContactPicker
          compact
          value={filters.contact ? { id: filters.contact, label: name.data ?? t('contactLoading') } : null}
          onChange={(c) => onChange({ contact: c?.id ?? '' })}
        />
        <Select
          value={filters.order}
          onChange={(e) => onChange({ order: e.target.value as InvoiceFilters['order'] })}
          aria-label={t('sort')}
          className="w-auto min-w-40"
        >
          {ORDERS.map((o) => (
            <option key={o} value={o}>
              {t(o === 'desc' ? 'sorts.newest' : 'sorts.oldest')}
            </option>
          ))}
        </Select>
        {filtered && (
          <Button variant="ghost" onClick={onReset}>
            {t('reset')}
          </Button>
        )}
        <Button variant="secondary" onClick={onRefresh} aria-label={t('refresh')} title={t('refresh')} className="ms-auto size-10 px-0">
          {refreshing ? <Spinner /> : <RefreshIcon />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <fieldset className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <legend className="sr-only">{t('issuedWindow')}</legend>
          <span className="shrink-0" aria-hidden="true">
            {t('issued')}
          </span>
          <Input type="date" value={filters.issuedFrom} max={filters.issuedTo || undefined} onChange={(e) => setIssued({ from: e.target.value })} className={date} aria-label={t('issuedFrom')} />
          <span aria-hidden="true">-</span>
          <Input type="date" value={filters.issuedTo} min={filters.issuedFrom || undefined} onChange={(e) => setIssued({ to: e.target.value })} className={date} aria-label={t('issuedTo')} />
        </fieldset>
        <fieldset className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <legend className="sr-only">{t('dueWindow')}</legend>
          <span className="shrink-0" aria-hidden="true">
            {t('due')}
          </span>
          <Input type="date" value={filters.dueFrom} max={filters.dueTo || undefined} onChange={(e) => setDue({ from: e.target.value })} className={date} aria-label={t('dueFrom')} />
          <span aria-hidden="true">-</span>
          <Input type="date" value={filters.dueTo} min={filters.dueFrom || undefined} onChange={(e) => setDue({ to: e.target.value })} className={date} aria-label={t('dueTo')} />
        </fieldset>
        <Select
          value={filters.docType}
          onChange={(e) => onChange({ docType: e.target.value as InvoiceFilters['docType'] })}
          aria-label={t('docType')}
          className="w-auto min-w-36"
        >
          <option value="">{t('anyDocType')}</option>
          {INVOICE_DOC_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`docTypes.${d}`)}
            </option>
          ))}
        </Select>
        <CurrencyBox key={filters.currency} value={filters.currency} onApply={(currency) => onChange({ currency })} />
        <Checkbox
          id="invoices-mine"
          checked={filters.mine}
          onChange={(e) => onChange({ mine: e.target.checked })}
          label={t('mine')}
          className="items-center"
        />
      </div>
    </div>
  );
}
