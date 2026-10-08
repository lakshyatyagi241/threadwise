'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Input, Select } from '@crm/ui';
import { PAYMENT_STATUSES } from '../lib/status';
import {
  cleanGatewayCode,
  hasActiveFilters,
  methodChoice,
  rangeIsInverted,
  type MethodChoice,
  type PaymentFilters,
} from '../lib/payments-filters';

const SEARCH_DELAY_MS = 350;

/** Status, method, date range and search. The address holds the values; this bar only reports a change. */
export function PaymentsFiltersBar({
  filters,
  onChange,
  onReset,
}: {
  filters: PaymentFilters;
  onChange: (next: PaymentFilters) => void;
  onReset: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.filters');
  const status = useTranslations('checkout-orders-merchant-payments.paymentStatus');
  const id = useId();

  // The search box is typed into faster than the address should change: wait for a pause.
  const [draft, setDraft] = useState(filters.q);
  const lastSent = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== lastSent.current) {
      lastSent.current = filters.q;
      setDraft(filters.q);
    }
  }, [filters.q]);
  useEffect(() => {
    if (draft.trim() === filters.q) return;
    const timer = setTimeout(() => {
      lastSent.current = draft.trim();
      onChange({ ...filters, q: draft.trim() });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, filters, onChange]);

  // "A gateway" with no code typed yet is not a filter, so the select remembers that choice itself.
  const [gatewayPicked, setGatewayPicked] = useState(false);
  const choice: MethodChoice = gatewayPicked ? 'gateway' : methodChoice(filters.method);

  function pickMethod(value: string) {
    if (value === 'gateway') {
      setGatewayPicked(true);
      if (filters.method === 'prepaid' || filters.method === 'cod')
        onChange({ ...filters, method: '' });
      return;
    }
    setGatewayPicked(false);
    onChange({ ...filters, method: value });
  }

  const inverted = rangeIsInverted(filters);
  const active = hasActiveFilters(filters) || draft.trim() !== '';

  return (
    <div className="space-y-3" data-testid="payments-filters">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-q`} className="text-xs font-medium text-muted-foreground">
            {t('search')}
          </label>
          <Input
            id={`${id}-q`}
            type="search"
            value={draft}
            maxLength={120}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="text-xs font-medium text-muted-foreground">
            {t('status')}
          </label>
          <Select
            id={`${id}-status`}
            value={filters.status}
            onChange={(e) =>
              onChange({ ...filters, status: e.target.value as PaymentFilters['status'] })
            }
          >
            <option value="">{t('allStatuses')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {status(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-method`} className="text-xs font-medium text-muted-foreground">
            {t('method')}
          </label>
          <Select id={`${id}-method`} value={choice} onChange={(e) => pickMethod(e.target.value)}>
            <option value="">{t('allMethods')}</option>
            <option value="prepaid">{t('prepaid')}</option>
            <option value="cod">{t('cod')}</option>
            <option value="gateway">{t('gatewayOption')}</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-from`} className="text-xs font-medium text-muted-foreground">
            {t('from')}
          </label>
          <Input
            id={`${id}-from`}
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-to`} className="text-xs font-medium text-muted-foreground">
            {t('to')}
          </label>
          <Input
            id={`${id}-to`}
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
          />
        </div>
      </div>

      {choice === 'gateway' && (
        <div className="max-w-xs space-y-1">
          <label htmlFor={`${id}-gw`} className="text-xs font-medium text-muted-foreground">
            {t('gatewayCode')}
          </label>
          <Input
            id={`${id}-gw`}
            value={filters.method === 'prepaid' || filters.method === 'cod' ? '' : filters.method}
            placeholder={t('gatewayCodePlaceholder')}
            dir="ltr"
            autoComplete="off"
            onChange={(e) => onChange({ ...filters, method: cleanGatewayCode(e.target.value) })}
          />
        </div>
      )}

      {inverted && <Alert tone="warning">{t('rangeInverted')}</Alert>}

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setGatewayPicked(false);
            setDraft('');
            lastSent.current = '';
            onReset();
          }}
        >
          {t('reset')}
        </Button>
      )}
    </div>
  );
}
