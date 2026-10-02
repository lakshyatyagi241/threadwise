'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InvoiceSummary, TaxRateResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Select, Spinner, Textarea, cn } from '@crm/ui';
import { invoicingApi } from '../api/service';
import { draftOf, usedIndexes, withContact, type InvoiceDraft } from '../lib/builder';
import { TEMPLATE_PAYMENT_TERMS, suggestName, type PickedInvoice, type RecurringForm, type TemplateSource } from '../lib/recurring';
import { invoiceMinor } from '../lib/wire';
import { ContactPicker } from './contact-picker';
import { CopyDocIcon } from './icons';
import { InvoiceLinesEditor } from './line-items-editor';
import { ErrorLine, Money, UserText } from './parts';
import { PickInvoiceDialog } from './pick-invoice-dialog';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'JPY', 'KWD', 'CAD', 'AUD', 'SGD', 'CHF'];

export const pickedOf = (inv: InvoiceSummary): PickedInvoice => ({
  id: inv.id,
  number: inv.number,
  buyerName: inv.buyerName,
  currency: inv.currency,
  totalMinor: invoiceMinor(inv).total,
});

const card = 'space-y-4 rounded-xl border border-border bg-background p-4 sm:p-5';

interface SectionProps {
  form: RecurringForm;
  onForm: (patch: Partial<RecurringForm>) => void;
  /** Texts to show by path: `lines.0.qty`, `buyerEmail`, `template` ... */
  errors: Record<string, string>;
  rates: readonly TaxRateResponse[];
  showHsn: boolean;
  /** Minor units of each draft line, by index, for the lines editor. */
  lineAmounts: ReadonlyArray<number | null>;
  disabled?: boolean;
  /** Editing: the source is always the built template (an invoice is loaded into it). */
  editing?: boolean;
}

/** The invoice every period is made from: copied from an existing invoice, or built right here. */
export function RecurringTemplateSection(props: SectionProps) {
  const t = useTranslations('invoicing.recurring.template');
  const { form, onForm, errors, editing, disabled } = props;
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const setSource = (source: TemplateSource) => onForm({ source });

  /** Editing: a picked invoice fills the template editor (the API wants the whole template, not a reference, on update). */
  async function loadInvoice(inv: InvoiceSummary) {
    setPicking(false);
    setLoading(true);
    setLoadError(null);
    try {
      const full = await invoicingApi.get(inv.id);
      onForm({ draft: draftOf(full), source: 'build', paymentTermsDays: '' });
    } catch (e) {
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="rec-template" className={card}>
      <div>
        <h2 id="rec-template" className="text-base font-semibold">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{editing ? t('hintEdit') : t('hint')}</p>
      </div>

      {!editing && (
        <div role="radiogroup" aria-label={t('sourceLabel')} className="grid gap-2 sm:grid-cols-2">
          {(['invoice', 'build'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={form.source === s}
              disabled={disabled}
              onClick={() => setSource(s)}
              className={cn(
                'min-h-14 rounded-lg border p-3 text-start outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60',
                form.source === s ? 'border-brand bg-brand/5' : 'border-border hover:bg-muted',
              )}
            >
              <span className="block text-sm font-medium">{t(`source.${s}.title`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`source.${s}.hint`)}</span>
            </button>
          ))}
        </div>
      )}

      {form.source === 'invoice' && !editing ? (
        <div className="space-y-2">
          {form.fromInvoice ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <CopyDocIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" dir="auto">
                  {form.fromInvoice.number ?? t('draftInvoice')}
                  {form.fromInvoice.buyerName ? ` - ${form.fromInvoice.buyerName}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('copyOf')} <Money minor={form.fromInvoice.totalMinor} currency={form.fromInvoice.currency} />
                </div>
              </div>
              <Button variant="secondary" className="h-10" disabled={disabled} onClick={() => setPicking(true)}>
                {t('change')}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" className="min-h-10" disabled={disabled} onClick={() => setPicking(true)}>
              <CopyDocIcon /> {t('choose')}
            </Button>
          )}
          {errors.template && (
            <p role="alert" className="text-xs text-danger">
              {errors.template}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('copyNote')}</p>
        </div>
      ) : (
        <>
          {editing && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" className="min-h-10" disabled={disabled || loading} onClick={() => setPicking(true)}>
                {loading ? <Spinner /> : <CopyDocIcon />} {t('startFromInvoice')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('startFromInvoiceHint')}</span>
            </div>
          )}
          {loadError !== null && <ErrorLine error={loadError} />}
          <TemplateEditor {...props} />
        </>
      )}

      {picking && (
        <PickInvoiceDialog
          statuses={['draft', 'issued', 'partially_paid', 'overdue', 'paid']}
          onClose={() => setPicking(false)}
          onPick={(inv) => {
            if (editing) void loadInvoice(inv);
            else {
              setPicking(false);
              onForm({
                source: 'invoice',
                fromInvoice: pickedOf(inv),
                name: form.name.trim() === '' ? suggestName(pickedOf(inv)) : form.name,
              });
            }
          }}
        />
      )}
    </section>
  );
}

/** The buyer, currency, lines, discount, shipping, notes and terms of a template built by hand. */
function TemplateEditor({ form, onForm, errors, rates, showHsn, lineAmounts, disabled }: SectionProps) {
  const t = useTranslations('invoicing.recurring.template');
  const d = form.draft;
  const set = (patch: Partial<InvoiceDraft>) => onForm({ draft: { ...d, ...patch } });
  const currencies = useMemo(() => (CURRENCIES.includes(d.currency) ? CURRENCIES : [d.currency, ...CURRENCIES]), [d.currency]);
  const lineErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('lines')));
  const amounts = useMemo(() => {
    // `lineAmounts` is by priced line; the editor wants it by draft line.
    const used = usedIndexes(d.lines);
    const out: Array<number | null> = d.lines.map(() => null);
    used.forEach((draftIndex, i) => {
      out[draftIndex] = lineAmounts[i] ?? null;
    });
    return out;
  }, [d.lines, lineAmounts]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t('billTo')}</h3>
        <Field label={t('contact')} htmlFor="rt-contact" hint={t('contactHint')}>
          <ContactPicker
            id="rt-contact"
            value={d.contactId ? { id: d.contactId, label: d.contactLabel } : null}
            disabled={disabled}
            onChange={(c) => onForm({ draft: withContact(d, c) })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('buyerName')} htmlFor="rt-bname" error={errors.buyerName}>
            <Input id="rt-bname" dir="auto" disabled={disabled} value={d.buyerName} invalid={!!errors.buyerName} onChange={(e) => set({ buyerName: e.target.value })} />
          </Field>
          <Field label={t('buyerEmail')} htmlFor="rt-bemail" error={errors.buyerEmail}>
            <Input id="rt-bemail" type="email" dir="ltr" disabled={disabled} value={d.buyerEmail} invalid={!!errors.buyerEmail} onChange={(e) => set({ buyerEmail: e.target.value })} />
          </Field>
          <Field label={t('buyerPhone')} htmlFor="rt-bphone" error={errors.buyerPhone}>
            <Input id="rt-bphone" type="tel" dir="ltr" disabled={disabled} value={d.buyerPhone} invalid={!!errors.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} />
          </Field>
          <Field label={t('buyerCountry')} htmlFor="rt-bcountry" error={errors.buyerCountry} hint={t('buyerCountryHint')}>
            <Input
              id="rt-bcountry"
              dir="ltr"
              maxLength={2}
              disabled={disabled}
              value={d.buyerCountry}
              invalid={!!errors.buyerCountry}
              onChange={(e) => set({ buyerCountry: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label={t('buyerTaxId')} htmlFor="rt-btax" error={errors.buyerTaxId}>
            <Input id="rt-btax" dir="ltr" disabled={disabled} value={d.buyerTaxId} invalid={!!errors.buyerTaxId} onChange={(e) => set({ buyerTaxId: e.target.value })} />
          </Field>
          <Field label={t('buyerAddress')} htmlFor="rt-baddr" error={errors.buyerAddress}>
            <Textarea id="rt-baddr" dir="auto" rows={2} disabled={disabled} value={d.buyerAddress} onChange={(e) => set({ buyerAddress: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t('details')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('currency')} htmlFor="rt-currency" error={errors.currency}>
            <Select id="rt-currency" disabled={disabled} value={d.currency} invalid={!!errors.currency} onChange={(e) => set({ currency: e.target.value })}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('docType')} htmlFor="rt-doctype">
            <Select id="rt-doctype" disabled={disabled} value={d.docType} onChange={(e) => set({ docType: e.target.value as InvoiceDraft['docType'] })}>
              <option value="tax_invoice">{t('docTypes.tax_invoice')}</option>
              <option value="proforma">{t('docTypes.proforma')}</option>
            </Select>
          </Field>
          <Field label={t('taxMode')} htmlFor="rt-taxmode" error={errors.taxMode} hint={d.taxMode === 'auto' ? t('taxModeAutoHint') : undefined}>
            <Select
              id="rt-taxmode"
              disabled={disabled}
              value={d.taxMode}
              invalid={!!errors.taxMode}
              onChange={(e) => set({ taxMode: e.target.value as InvoiceDraft['taxMode'] })}
            >
              <option value="rates">{t('taxModes.rates')}</option>
              <option value="auto">{t('taxModes.auto')}</option>
            </Select>
          </Field>
          {d.taxMode === 'auto' && (
            <Field label={t('supplyType')} htmlFor="rt-supply">
              <Select id="rt-supply" disabled={disabled} value={d.supplyType} onChange={(e) => set({ supplyType: e.target.value as InvoiceDraft['supplyType'] })}>
                <option value="goods">{t('supply.goods')}</option>
                <option value="services">{t('supply.services')}</option>
                <option value="digital">{t('supply.digital')}</option>
              </Select>
            </Field>
          )}
          <Field label={t('paymentTerms')} htmlFor="rt-terms-days" error={errors.paymentTermsDays} hint={t('paymentTermsHint')}>
            <Select
              id="rt-terms-days"
              disabled={disabled}
              value={form.paymentTermsDays}
              invalid={!!errors.paymentTermsDays}
              onChange={(e) => onForm({ paymentTermsDays: e.target.value })}
            >
              {TEMPLATE_PAYMENT_TERMS.map((v) => (
                <option key={v} value={v}>
                  {v === '' ? t('termsDefault') : v === '0' ? t('termsOnReceipt') : t('termsNet', { days: Number(v) })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t('lines')}</h3>
        <InvoiceLinesEditor
          lines={d.lines}
          onChange={(lines) => set({ lines })}
          currency={d.currency}
          taxRates={rates}
          showHsn={showHsn}
          disabled={disabled}
          errors={lineErrors}
          taxMode={d.taxMode}
          amounts={amounts}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t('adjustments')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('discountKind')} htmlFor="rt-dkind">
            <Select id="rt-dkind" disabled={disabled} value={d.discountKind} onChange={(e) => set({ discountKind: e.target.value as InvoiceDraft['discountKind'] })}>
              <option value="none">{t('discountNone')}</option>
              <option value="percent">{t('discountPercent')}</option>
              <option value="amount">{t('discountAmount', { currency: d.currency })}</option>
            </Select>
          </Field>
          {d.discountKind !== 'none' && (
            <Field label={t('discountValue')} htmlFor="rt-dvalue" error={errors.discount}>
              <Input id="rt-dvalue" inputMode="decimal" dir="ltr" disabled={disabled} value={d.discountText} invalid={!!errors.discount} onChange={(e) => set({ discountText: e.target.value })} />
            </Field>
          )}
          <Field label={t('shipping', { currency: d.currency })} htmlFor="rt-ship" error={errors.shipping}>
            <Input id="rt-ship" inputMode="decimal" dir="ltr" disabled={disabled} value={d.shipping} placeholder="0" invalid={!!errors.shipping} onChange={(e) => set({ shipping: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('notes')} htmlFor="rt-notes" hint={t('notesHint')}>
          <Textarea id="rt-notes" dir="auto" rows={3} disabled={disabled} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <Field label={t('termsText')} htmlFor="rt-termstext" hint={t('termsTextHint')}>
          <Textarea id="rt-termstext" dir="auto" rows={3} disabled={disabled} value={d.terms} onChange={(e) => set({ terms: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

/** A read-only line about the template of a saved schedule (the API does not send the template back). */
export function TemplateKept({ buyer, lineCount, amount }: { buyer: string | null; lineCount: number; amount: { minor: number; currency: string } }) {
  const t = useTranslations('invoicing.recurring.template');
  return (
    <Alert tone="info" className="text-sm">
      <p>
        {t('kept', { count: lineCount })}
        {buyer ? (
          <>
            {' '}
            <UserText className="font-medium">{buyer}</UserText>.
          </>
        ) : null}{' '}
        <Money minor={amount.minor} currency={amount.currency} className="font-medium" />
      </p>
    </Alert>
  );
}
