'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { TaxRateResponse } from '@crm/contracts';
import { Button, Field, Input, Select, Textarea } from '@crm/ui';
import {
  TAX_DEFAULT,
  TAX_NONE,
  TAX_SNAPSHOT,
  emptyLine,
  isBlankLine,
  newKey,
  rateOfLine,
  type DraftLine,
} from '../lib/builder';
import { formatMoney } from '../lib/money';
import { taxLabel } from '../lib/totals';
import { PlusIcon, TrashIcon } from './icons';

/** "GST 18%" or "Sales tax 10% incl.", the label of a tax rate in a select. */
export function rateLabel(
  r: Pick<TaxRateResponse, 'name' | 'rate' | 'inclusive'>,
  inclusiveWord: string,
): string {
  return `${taxLabel(r.name, r.rate)}${r.inclusive ? ` (${inclusiveWord})` : ''}`;
}

/**
 * Props of `InvoiceLinesEditor`, the lines of an invoice-like document. It is reusable: recurring-invoice templates and sales orders
 * edit the very same lines (`DraftLine`) and send them through `linesToInput` (lib/builder).
 *
 * `errors` is keyed by path over the DRAFT's lines: `lines.<index>.<field>` with the field one of
 * `description | qty | unitPrice | discount | hsnSac | taxRateId`, and `lines` for a problem with the list itself. The values are
 * the texts to show (already translated); build them from `validateDraft` / `lineProblems` or from the server's field errors.
 */
export interface InvoiceLinesEditorProps {
  /** The lines (controlled). Blank lines are fine: they are dropped by `linesToInput`. */
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** ISO 4217 code of the document: labels the price and formats the amounts. */
  currency: string;
  /** The workspace's tax rates (`GET /tax-rates`); only active ones can be picked, an inactive one stays shown on a line that uses it. */
  taxRates: readonly TaxRateResponse[];
  /** Show the HSN/SAC box (only where the seller's country asks for it: `hsnRequired(country)`). */
  showHsn: boolean;
  disabled?: boolean;
  errors?: Record<string, string>;
  /** `auto` tax mode: the tax select reads "Automatic" for the default choice (the tax engine decides), and a rate acts as a slab. */
  taxMode?: 'rates' | 'auto';
  /** Each line's amount in minor units of `currency`, by draft line index (shown at the end of the line). */
  amounts?: ReadonlyArray<number | null | undefined>;
}

/**
 * The line items: a description, quantity, unit price, line discount, tax rate (and HSN/SAC where the country asks) and the line's
 * amount, one card per line so nothing scrolls sideways on a phone.
 */
export function InvoiceLinesEditor({
  lines,
  onChange,
  currency,
  taxRates,
  showHsn,
  disabled,
  errors = {},
  taxMode = 'rates',
  amounts,
}: InvoiceLinesEditorProps) {
  const t = useTranslations('invoicing.lines');
  const locale = useLocale();
  const set = (key: string, patch: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length > 0 ? next : [emptyLine()]);
  };
  const add = () => {
    const last = lines[lines.length - 1];
    onChange([
      ...lines,
      {
        ...emptyLine(last?.taxRateId ?? TAX_DEFAULT),
        key: newKey(),
        taxSnapshot: last?.taxSnapshot ?? null,
      },
    ]);
  };
  const active = taxRates.filter((r) => r.isActive);
  const defaultRate = taxRates.find((r) => r.isDefault && r.isActive) ?? null;

  return (
    <div className="space-y-3">
      {lines.map((l, i) => {
        const err = (field: string) => errors[`lines.${i}.${field}`];
        const id = (f: string) => `line-${l.key}-${f}`;
        const known =
          [TAX_DEFAULT, TAX_NONE, TAX_SNAPSHOT].includes(l.taxRateId) ||
          taxRates.some((r) => r.id === l.taxRateId);
        const inactiveUsed = taxRates.filter((r) => !r.isActive && r.id === l.taxRateId);
        const amount = amounts?.[i];
        const hsnHint = rateOfLine(l, taxRates)?.defaultHsnSac ?? '';
        return (
          <div
            key={l.key}
            className="space-y-3 rounded-lg border border-border bg-background p-3 sm:p-4"
            role="group"
            aria-label={t('lineN', { n: i + 1 })}
          >
            <div className="flex items-start gap-2">
              <Field
                label={t('description')}
                htmlFor={id('desc')}
                error={err('description')}
                className="min-w-0 flex-1"
              >
                <Textarea
                  id={id('desc')}
                  rows={1}
                  dir="auto"
                  disabled={disabled}
                  value={l.description}
                  placeholder={t('descriptionPlaceholder')}
                  onChange={(e) => set(l.key, { description: e.target.value })}
                  className="min-h-10 resize-y"
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                className="mt-7 size-10 shrink-0 px-0 text-muted-foreground hover:text-danger"
                aria-label={t('removeLine', { n: i + 1 })}
                title={t('removeLine', { n: i + 1 })}
                disabled={disabled || (lines.length === 1 && isBlankLine(l))}
                onClick={() => remove(l.key)}
              >
                <TrashIcon />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Field label={t('qty')} htmlFor={id('qty')} error={err('qty')}>
                <Input
                  id={id('qty')}
                  inputMode="decimal"
                  dir="ltr"
                  disabled={disabled}
                  value={l.qty}
                  invalid={!!err('qty')}
                  onChange={(e) => set(l.key, { qty: e.target.value })}
                />
              </Field>
              <Field
                label={t('price', { currency })}
                htmlFor={id('price')}
                error={err('unitPrice')}
              >
                <Input
                  id={id('price')}
                  inputMode="decimal"
                  dir="ltr"
                  disabled={disabled}
                  value={l.price}
                  placeholder="0"
                  invalid={!!err('unitPrice')}
                  onChange={(e) => set(l.key, { price: e.target.value })}
                />
              </Field>
              <Field label={t('discount')} htmlFor={id('disc')} error={err('discount')}>
                <div className="flex gap-1.5">
                  <Select
                    aria-label={t('discountKind')}
                    disabled={disabled}
                    value={l.discountKind}
                    className="w-20 shrink-0"
                    onChange={(e) =>
                      set(l.key, { discountKind: e.target.value as DraftLine['discountKind'] })
                    }
                  >
                    <option value="percent">%</option>
                    <option value="amount">{currency}</option>
                  </Select>
                  <Input
                    id={id('disc')}
                    inputMode="decimal"
                    dir="ltr"
                    disabled={disabled}
                    value={l.discount}
                    placeholder="0"
                    invalid={!!err('discount')}
                    onChange={(e) => set(l.key, { discount: e.target.value })}
                    className="min-w-0"
                  />
                </div>
              </Field>
              <Field label={t('tax')} htmlFor={id('tax')} error={err('taxRateId')}>
                <Select
                  id={id('tax')}
                  disabled={disabled}
                  value={l.taxRateId}
                  onChange={(e) => {
                    const v = e.target.value;
                    const picked = taxRates.find((r) => r.id === v);
                    const prev = rateOfLine(l, taxRates)?.defaultHsnSac ?? '';
                    const patch: Partial<DraftLine> = {
                      taxRateId: v,
                      taxSnapshot: v === TAX_SNAPSHOT ? l.taxSnapshot : null,
                    };
                    // The code of the rate fills an empty HSN/SAC box (or one that only held the previous rate's code).
                    if (
                      showHsn &&
                      picked?.defaultHsnSac &&
                      (l.hsnSac.trim() === '' || l.hsnSac === prev)
                    ) {
                      patch.hsnSac = picked.defaultHsnSac;
                    }
                    set(l.key, patch);
                  }}
                >
                  <option value={TAX_DEFAULT}>
                    {taxMode === 'auto'
                      ? t('taxAuto')
                      : defaultRate
                        ? t('taxDefault', { rate: rateLabel(defaultRate, t('inclusive')) })
                        : t('taxDefaultNone')}
                  </option>
                  <option value={TAX_NONE}>{t('noTax')}</option>
                  {l.taxRateId === TAX_SNAPSHOT && l.taxSnapshot && (
                    <option value={TAX_SNAPSHOT}>
                      {t('removedRateOption', {
                        rate: rateLabel(
                          {
                            name: l.taxSnapshot.name,
                            rate: l.taxSnapshot.rate,
                            inclusive: l.taxSnapshot.inclusive,
                          },
                          t('inclusive'),
                        ),
                      })}
                    </option>
                  )}
                  {!known && <option value={l.taxRateId}>{t('removedRate')}</option>}
                  {active.map((r) => (
                    <option key={r.id} value={r.id}>
                      {rateLabel(r, t('inclusive'))}
                    </option>
                  ))}
                  {inactiveUsed.map((r) => (
                    <option key={r.id} value={r.id}>
                      {rateLabel(r, t('inclusive'))} - {t('inactive')}
                    </option>
                  ))}
                </Select>
              </Field>
              {showHsn && (
                <Field label={t('hsn')} htmlFor={id('hsn')} error={err('hsnSac')}>
                  <Input
                    id={id('hsn')}
                    dir="ltr"
                    maxLength={12}
                    disabled={disabled}
                    value={l.hsnSac}
                    placeholder={hsnHint || t('hsnPlaceholder')}
                    invalid={!!err('hsnSac')}
                    onChange={(e) => set(l.key, { hsnSac: e.target.value.toUpperCase() })}
                  />
                </Field>
              )}
              <div className="col-span-2 text-end lg:col-span-4">
                <div className="text-xs font-medium text-muted-foreground">{t('amount')}</div>
                <div dir="ltr" className="text-base font-semibold tabular-nums">
                  {formatMoney(amount ?? 0, currency, locale)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {errors.lines && (
        <p role="alert" className="text-xs text-danger">
          {errors.lines}
        </p>
      )}
      <Button variant="secondary" onClick={add} disabled={disabled} className="min-h-10">
        <PlusIcon /> {t('addLine')}
      </Button>
    </div>
  );
}
