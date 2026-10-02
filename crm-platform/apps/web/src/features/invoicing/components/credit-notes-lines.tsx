'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { TaxRateResponse } from '@crm/contracts';
import { Button, Input, Select, cn } from '@crm/ui';
import {
  checkCreditQty,
  creditAmount,
  lineRemaining,
  newFreeLine,
  num,
  qtyText,
  type CreditedPart,
  type CreditForm,
  type FormProblem,
  type FreeLine,
  type InvoiceFacts,
} from '../lib/credit-notes';
import { formatMoney } from '../lib/money';
import { percentLabel } from '../lib/wire';
import { PlusIcon, TrashIcon } from './icons';
import { UserText } from './parts';

/**
 * What to credit, line by line. Each line of the invoice has a checkbox and the quantity to credit (the whole quantity that is
 * still left by default; earlier issued credit notes already took their part), and free-form lines (a goodwill amount, with an
 * optional tax rate) can be added below.
 */
export function CreditLinesPicker({
  form,
  invoice,
  credited,
  taxRates,
  problems,
  onChange,
}: {
  form: CreditForm;
  invoice: InvoiceFacts;
  credited: ReadonlyMap<string, CreditedPart>;
  taxRates: readonly TaxRateResponse[];
  problems: Record<string, FormProblem>;
  onChange: (patch: Partial<CreditForm>) => void;
}) {
  const t = useTranslations('invoicing.creditNotes.lines');
  const tp = useTranslations('invoicing.creditNotes.problems');
  const locale = useLocale();
  const money = (minor: bigint) => formatMoney(num(minor), invoice.currency, locale);

  const setChoice = (id: string, patch: Partial<{ checked: boolean; qty: string }>) =>
    onChange({
      choices: {
        ...form.choices,
        [id]: { ...(form.choices[id] ?? { checked: false, qty: '' }), ...patch },
      },
    });
  const setFree = (key: string, patch: Partial<FreeLine>) =>
    onChange({ free: form.free.map((f) => (f.key === key ? { ...f, ...patch } : f)) });

  return (
    <div className="space-y-4">
      <ul
        className="divide-y divide-border rounded-md border border-border"
        aria-label={t('invoiceLines')}
      >
        {invoice.lines.map((l) => {
          const r = lineRemaining(l, credited.get(l.id), invoice.currency);
          const c = form.choices[l.id];
          const checked = !!c?.checked && !r.done;
          const q = checkCreditQty(c?.qty ?? '', r.qtyScaled);
          const amount = checked && q.ok ? creditAmount(r, q.qtyScaled) : r.amountMinor;
          const problem = problems[`qty:${l.id}`];
          const done = credited.get(l.id);
          return (
            <li key={l.id} className={cn('p-3', r.done && 'bg-muted/40')}>
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={r.done}
                  onChange={(e) => setChoice(l.id, { checked: e.target.checked })}
                  aria-label={t('creditLine', { name: l.description })}
                  className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--brand)] disabled:cursor-not-allowed"
                />
                <div className="min-w-0 flex-1 basis-48">
                  <UserText className="block font-medium">{l.description}</UserText>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('lineFacts', {
                      qty: qtyText(r.fullQtyScaled),
                      amount: money(r.taxableMinor),
                    })}
                    {Number(l.taxRate) > 0 && (
                      <>
                        {' · '}
                        {t(l.taxInclusive ? 'taxIncluded' : 'taxAdded', {
                          name: l.taxName ?? t('tax'),
                          rate: percentLabel(l.taxRate),
                        })}
                      </>
                    )}
                  </p>
                  {done && !r.done && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('alreadyCredited', {
                        qty: qtyText(done.qtyScaled),
                        left: qtyText(r.qtyScaled),
                      })}
                    </p>
                  )}
                  {r.done && (
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {t('fullyCredited')}
                    </p>
                  )}
                </div>
                {!r.done && (
                  <div className="flex items-end gap-3">
                    <div className="w-28">
                      <label
                        htmlFor={`qty-${l.id}`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        {t('qtyToCredit')}
                      </label>
                      <Input
                        id={`qty-${l.id}`}
                        inputMode="decimal"
                        dir="ltr"
                        disabled={!checked}
                        value={c?.qty ?? ''}
                        placeholder={qtyText(r.qtyScaled)}
                        invalid={!!problem}
                        aria-describedby={problem ? `qty-err-${l.id}` : undefined}
                        onChange={(e) => setChoice(l.id, { qty: e.target.value })}
                        className="text-end"
                      />
                    </div>
                    <div className="min-w-24 pb-2.5 text-end text-sm tabular-nums" dir="ltr">
                      {checked && q.ok ? (
                        money(amount)
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {problem && (
                <p id={`qty-err-${l.id}`} role="alert" className="mt-1.5 ps-8 text-xs text-danger">
                  {tp(problem, { max: qtyText(r.qtyScaled) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{t('freeTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('freeHint')}</p>
        </div>
        {form.free.map((f) => {
          const dp = problems[`free:${f.key}:description`];
          const ap = problems[`free:${f.key}:amount`];
          return (
            <div
              key={f.key}
              className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_9rem_11rem_auto] sm:items-start"
            >
              <div>
                <label htmlFor={`${f.key}-d`} className="mb-1 block text-xs text-muted-foreground">
                  {t('description')}
                </label>
                <Input
                  id={`${f.key}-d`}
                  dir="auto"
                  maxLength={500}
                  value={f.description}
                  invalid={!!dp}
                  onChange={(e) => setFree(f.key, { description: e.target.value })}
                />
                {dp && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {tp(dp)}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${f.key}-a`} className="mb-1 block text-xs text-muted-foreground">
                  {t('amount')}
                </label>
                <Input
                  id={`${f.key}-a`}
                  inputMode="decimal"
                  dir="ltr"
                  className="text-end"
                  value={f.amount}
                  invalid={!!ap}
                  onChange={(e) => setFree(f.key, { amount: e.target.value })}
                />
                {ap && (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {tp(ap)}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${f.key}-t`} className="mb-1 block text-xs text-muted-foreground">
                  {t('taxRate')}
                </label>
                <Select
                  id={`${f.key}-t`}
                  value={f.taxRateId}
                  onChange={(e) => setFree(f.key, { taxRateId: e.target.value })}
                >
                  <option value="">{t('noTax')}</option>
                  {taxRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({percentLabel(r.rate)}%{r.inclusive ? `, ${t('inclusive')}` : ''})
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                onClick={() => onChange({ free: form.free.filter((x) => x.key !== f.key) })}
                aria-label={t('removeFree')}
                className="flex size-10 items-center justify-center self-end rounded-md text-muted-foreground hover:bg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:mt-5"
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
        <Button
          variant="secondary"
          onClick={() => onChange({ free: [...form.free, newFreeLine()] })}
          className="h-10"
        >
          <PlusIcon /> {t('addFree')}
        </Button>
      </div>
    </div>
  );
}
