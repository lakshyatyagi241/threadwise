'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceProfile } from '@crm/contracts';
import { Alert, Checkbox, Field, Input, Select, Textarea, cn } from '@crm/ui';
import type { InvoiceDraft, SupplyKind, TaxMode } from '../lib/builder';
import { taxIdCheckOf, withContact } from '../lib/builder';
import { addDays, isDay, TERM_DAYS, dueFrom, termOf } from '../lib/dates';
import { SUPPLY_TYPES, profileOf, regionOptions } from '../lib/tax-info';
import { ContactPicker } from './contact-picker';

/** What every section gets: the working copy, how to change it, and the error text of a path (local checks and the server's). */
export interface SectionProps {
  draft: InvoiceDraft;
  setDraft: (update: (d: InvoiceDraft) => InvoiceDraft) => void;
  error: (path: string) => string | undefined;
  disabled?: boolean;
}

export function Card({ title, children, single, aside }: { title: string; children: React.ReactNode; single?: boolean; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className={single ? '' : 'grid gap-4 sm:grid-cols-2'}>{children}</div>
    </section>
  );
}

/** The live result of checking the buyer's tax id: the format, and the check digits where the country has a public algorithm. */
function TaxIdFeedback({ draft, sellerCountry }: { draft: InvoiceDraft; sellerCountry: string | null }) {
  const t = useTranslations('invoicing.builder');
  const c = taxIdCheckOf(draft, sellerCountry);
  if (c.state === 'empty') {
    return c.label ? <>{t('taxIdExpected', { label: c.label, example: c.example ?? '' })}</> : <>{t('taxIdHint')}</>;
  }
  if (c.state === 'unchecked') return <>{t('taxIdUnchecked')}</>;
  if (c.state === 'valid') {
    return (
      <span className="text-success">
        {t('taxIdValid', { label: c.label ?? '', level: c.level ?? 'format' })}
      </span>
    );
  }
  return (
    <span className="text-warning">
      {t('taxIdInvalid', { label: c.label ?? '', level: c.level ?? 'format' })}
      {c.reason ? ` ${c.reason}` : ''} {t('taxIdStillSave')}
    </span>
  );
}

export function BuyerSection({ draft, setDraft, error, disabled, sellerCountry }: SectionProps & { sellerCountry: string | null }) {
  const t = useTranslations('invoicing.builder');
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const check = taxIdCheckOf(draft, sellerCountry);
  return (
    <Card title={t('billTo')}>
      <Field label={t('contact')} htmlFor="inv-contact" hint={t('contactHint')} className="sm:col-span-2" error={error('buyerName')}>
        <ContactPicker
          id="inv-contact"
          disabled={disabled}
          invalid={!!error('buyerName')}
          value={draft.contactId ? { id: draft.contactId, label: draft.contactLabel || draft.buyerName } : null}
          onChange={(c) => setDraft((d) => withContact(d, c))}
        />
      </Field>
      <Field label={t('buyerName')} htmlFor="inv-name">
        <Input id="inv-name" dir="auto" disabled={disabled} value={draft.buyerName} onChange={(e) => set('buyerName', e.target.value)} />
      </Field>
      <Field label={t('buyerEmail')} htmlFor="inv-email" error={error('buyerEmail')}>
        <Input
          id="inv-email"
          type="email"
          dir="ltr"
          disabled={disabled}
          value={draft.buyerEmail}
          invalid={!!error('buyerEmail')}
          onChange={(e) => set('buyerEmail', e.target.value)}
        />
      </Field>
      <Field label={t('buyerPhone')} htmlFor="inv-phone">
        <Input id="inv-phone" type="tel" dir="ltr" disabled={disabled} value={draft.buyerPhone} onChange={(e) => set('buyerPhone', e.target.value)} />
      </Field>
      <Field label={t('buyerAddress')} htmlFor="inv-address">
        <Textarea id="inv-address" rows={2} dir="auto" disabled={disabled} value={draft.buyerAddress} onChange={(e) => set('buyerAddress', e.target.value)} />
      </Field>
      <Field label={t('buyerCountry')} htmlFor="inv-country" hint={t('buyerCountryHint')} error={error('buyerCountry')}>
        <Input
          id="inv-country"
          dir="ltr"
          maxLength={2}
          disabled={disabled}
          value={draft.buyerCountry}
          placeholder="IN"
          invalid={!!error('buyerCountry')}
          onChange={(e) => set('buyerCountry', e.target.value.toUpperCase())}
        />
      </Field>
      <Field
        label={check.label ? t('buyerTaxIdNamed', { label: check.label }) : t('buyerTaxId')}
        htmlFor="inv-taxid"
        className="sm:col-span-2"
        error={error('buyerTaxId')}
        hint={<TaxIdFeedback draft={draft} sellerCountry={sellerCountry} />}
      >
        <Input
          id="inv-taxid"
          dir="ltr"
          maxLength={40}
          disabled={disabled}
          value={draft.buyerTaxId}
          invalid={!!error('buyerTaxId') || check.state === 'invalid'}
          onChange={(e) => set('buyerTaxId', e.target.value)}
        />
      </Field>
    </Card>
  );
}

export function DetailsSection({ draft, setDraft, error, disabled }: SectionProps) {
  const t = useTranslations('invoicing.builder');
  const tt = useTranslations('invoicing.terms');
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const termValue = (() => {
    if (!isDay(draft.dueDate)) return draft.dueDate === '' ? 'none' : 'custom';
    if (!isDay(draft.issueDate)) return 'custom';
    const n = termOf(draft.issueDate, draft.dueDate);
    return n === null ? 'custom' : String(n);
  })();
  const setTerm = (v: string) => {
    if (v === 'custom') return;
    if (v === 'none') return set('dueDate', '');
    if (isDay(draft.issueDate)) set('dueDate', dueFrom(draft.issueDate, Number(v)));
  };
  const setIssueDate = (v: string) =>
    // The due date keeps its term when the issue date moves.
    setDraft((d) => {
      const n = isDay(d.issueDate) && isDay(d.dueDate) ? termOf(d.issueDate, d.dueDate) : null;
      return { ...d, issueDate: v, dueDate: n !== null && isDay(v) ? addDays(v, n) : d.dueDate };
    });
  return (
    <Card title={t('details')}>
      <Field label={t('docType')} htmlFor="inv-doctype">
        <Select id="inv-doctype" disabled={disabled} value={draft.docType} onChange={(e) => set('docType', e.target.value as InvoiceDraft['docType'])}>
          <option value="tax_invoice">{t('docTypes.tax_invoice')}</option>
          <option value="proforma">{t('docTypes.proforma')}</option>
        </Select>
      </Field>
      <Field label={t('currency')} htmlFor="inv-currency" hint={t('currencyHint')} error={error('currency')}>
        <Input
          id="inv-currency"
          list="inv-currencies"
          maxLength={3}
          dir="ltr"
          disabled={disabled}
          value={draft.currency}
          invalid={!!error('currency')}
          onChange={(e) => set('currency', e.target.value.toUpperCase())}
        />
        <datalist id="inv-currencies">
          {CURRENCIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label={t('issueDate')} htmlFor="inv-issue" error={error('issueDate')}>
        <Input id="inv-issue" type="date" disabled={disabled} value={draft.issueDate} invalid={!!error('issueDate')} onChange={(e) => setIssueDate(e.target.value)} />
      </Field>
      <Field label={t('terms')} htmlFor="inv-term">
        <Select id="inv-term" disabled={disabled} value={termValue} onChange={(e) => setTerm(e.target.value)}>
          <option value="none">{t('noDueDate')}</option>
          {TERM_DAYS.map((d) => (
            <option key={d} value={String(d)}>
              {d === 0 ? tt('onReceipt') : tt('net', { days: d })}
            </option>
          ))}
          {termValue === 'custom' && <option value="custom">{tt('custom')}</option>}
        </Select>
      </Field>
      <Field label={t('dueDate')} htmlFor="inv-due" error={error('dueDate')}>
        <Input
          id="inv-due"
          type="date"
          disabled={disabled}
          value={draft.dueDate}
          min={draft.issueDate || undefined}
          invalid={!!error('dueDate')}
          onChange={(e) => set('dueDate', e.target.value)}
        />
      </Field>
      <Field label={t('reference')} htmlFor="inv-ref" hint={t('referenceHint')}>
        <Input id="inv-ref" dir="auto" maxLength={191} disabled={disabled} value={draft.reference} onChange={(e) => set('reference', e.target.value)} />
      </Field>
    </Card>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR', 'JPY', 'KWD', 'CAD', 'AUD', 'SGD', 'CHF'];

/**
 * The tax of the invoice: pick a tax rate per line (`rates`), or let the tax engine decide from the seller's country (the
 * invoicing profile), the buyer's country and tax id, the supply type and the place of supply (`auto`).
 */
export function TaxSection({
  draft,
  setDraft,
  error,
  disabled,
  profile,
}: SectionProps & { profile: Pick<InvoiceProfile, 'sellerCountry' | 'sellerState'> | undefined }) {
  const t = useTranslations('invoicing.builder');
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const sellerCountry = profile?.sellerCountry ?? null;
  const known = !!profileOf(sellerCountry);
  const placeCountry = draft.buyerCountry.trim() || sellerCountry || '';
  const regions = regionOptions(placeCountry);
  const modes: TaxMode[] = ['rates', 'auto'];
  return (
    <Card title={t('tax')} single>
      <div className="space-y-4">
        <div role="radiogroup" aria-label={t('taxMode')} className="inline-flex w-full gap-1 rounded-md bg-muted p-1 sm:w-auto">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={draft.taxMode === m}
              disabled={disabled}
              onClick={() => set('taxMode', m)}
              className={cn(
                'min-h-10 flex-1 rounded px-4 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none',
                draft.taxMode === m ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`taxModes.${m}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`taxModeHint.${draft.taxMode}`)}</p>

        {draft.taxMode === 'auto' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 text-sm sm:col-span-2">
              <div className="font-medium">{t('sellerCountry')}</div>
              {sellerCountry && known ? (
                <div dir="ltr" className="inline-block rounded-md border border-border bg-muted/40 px-3 py-2">
                  {sellerCountry}
                  {profile?.sellerState ? ` - ${profile.sellerState}` : ''}
                </div>
              ) : (
                <Alert tone="warning" className="space-y-1">
                  <p>{error('taxMode') ?? t('sellerCountryMissing')}</p>
                </Alert>
              )}
            </div>
            <Field label={t('supplyType')} htmlFor="inv-supply">
              <Select id="inv-supply" disabled={disabled} value={draft.supplyType} onChange={(e) => set('supplyType', e.target.value as SupplyKind)}>
                {SUPPLY_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`supplyTypes.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('placeOfSupply')} htmlFor="inv-place" hint={t('placeOfSupplyHint', { country: placeCountry || '-' })} error={error('placeRegion')}>
              {regions.length > 0 ? (
                <Select id="inv-place" disabled={disabled} value={draft.placeRegion} onChange={(e) => set('placeRegion', e.target.value)}>
                  <option value="">{t('placeSameCountry')}</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name} ({placeCountry.toUpperCase()}-{r.code})
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="inv-place"
                  dir="ltr"
                  maxLength={3}
                  disabled={disabled}
                  value={draft.placeRegion}
                  placeholder={t('placeRegionPlaceholder')}
                  invalid={!!error('placeRegion')}
                  onChange={(e) => set('placeRegion', e.target.value.toUpperCase())}
                />
              )}
            </Field>
          </div>
        )}

        <Checkbox
          id="inv-reverse"
          disabled={disabled}
          checked={draft.reverseCharge}
          onChange={(e) => set('reverseCharge', e.target.checked)}
          label={
            <span>
              <span className="font-medium">{t('reverseCharge')}</span>
              <span className="block text-xs text-muted-foreground">{t('reverseChargeHint')}</span>
            </span>
          }
        />
      </div>
    </Card>
  );
}

export function AdjustmentsSection({ draft, setDraft, error, disabled }: SectionProps) {
  const t = useTranslations('invoicing.builder');
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Card title={t('adjustments')}>
      <Field label={t('discountKind')} htmlFor="inv-disc-kind">
        <Select
          id="inv-disc-kind"
          disabled={disabled}
          value={draft.discountKind}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              discountKind: e.target.value as InvoiceDraft['discountKind'],
              discountText: e.target.value === 'none' ? '' : d.discountText,
            }))
          }
        >
          <option value="none">{t('discountNone')}</option>
          <option value="percent">{t('discountPercent')}</option>
          <option value="amount">{t('discountAmount', { currency: draft.currency })}</option>
        </Select>
      </Field>
      <Field label={t('discountValue')} htmlFor="inv-disc" error={error('discount')}>
        <Input
          id="inv-disc"
          inputMode="decimal"
          dir="ltr"
          disabled={disabled || draft.discountKind === 'none'}
          value={draft.discountText}
          invalid={!!error('discount')}
          onChange={(e) => set('discountText', e.target.value)}
        />
      </Field>
      <Field label={t('shipping', { currency: draft.currency })} htmlFor="inv-ship" hint={t('shippingHint')} error={error('shipping')}>
        <Input
          id="inv-ship"
          inputMode="decimal"
          dir="ltr"
          disabled={disabled}
          value={draft.shipping}
          placeholder="0"
          invalid={!!error('shipping')}
          onChange={(e) => set('shipping', e.target.value)}
        />
      </Field>
    </Card>
  );
}

export function NotesSection({ draft, setDraft, disabled }: SectionProps) {
  const t = useTranslations('invoicing.builder');
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Card title={t('notesAndTerms')}>
      <Field label={t('notes')} htmlFor="inv-notes" hint={t('notesHint')}>
        <Textarea id="inv-notes" rows={3} dir="auto" disabled={disabled} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <Field label={t('termsText')} htmlFor="inv-terms-text" hint={t('termsHint')}>
        <Textarea id="inv-terms-text" rows={3} dir="auto" disabled={disabled} value={draft.terms} onChange={(e) => set('terms', e.target.value)} />
      </Field>
      <Field label={t('legalNotes')} htmlFor="inv-legal" hint={t('legalNotesHint')} className="sm:col-span-2">
        <Textarea
          id="inv-legal"
          rows={2}
          dir="auto"
          maxLength={1000}
          disabled={disabled}
          value={draft.legalNotes}
          onChange={(e) => set('legalNotes', e.target.value)}
        />
      </Field>
    </Card>
  );
}
