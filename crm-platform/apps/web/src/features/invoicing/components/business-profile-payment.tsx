'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Field, Textarea } from '@crm/ui';
import {
  LIMITS,
  MAX_BANK_ROWS,
  bankLabelSuggestions,
  normalizeRows,
  profileOf,
  type ProfileForm,
} from '../lib/profile-form';
import { RowsEditor, Section, SubHeading, type EditorCtx } from './business-profile-ui';

/** Payment details: the bank rows and instructions printed under the totals, with a small preview of how they print. */
export function PaymentSection({ form, set, err, readOnly }: EditorCtx) {
  const t = useTranslations('invoicing.settings.payment');
  const uid = useId();
  return (
    <Section id="payment" title={t('title')} description={t('description')}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <SubHeading hint={t('bankHint', { max: MAX_BANK_ROWS })}>{t('bankTitle')}</SubHeading>
            <RowsEditor
              rows={form.bankRows}
              onChange={(rows) => set('bankRows', rows)}
              max={MAX_BANK_ROWS}
              errPrefix="bankDetails"
              err={err}
              disabled={readOnly}
              suggestions={bankLabelSuggestions(form.sellerCountry)}
              labelMax={LIMITS.rowLabel}
              valueMax={LIMITS.bankValue}
              labelPlaceholder={t('rowLabelPlaceholder')}
              valuePlaceholder={t('rowValuePlaceholder')}
            />
          </div>
          <Field
            label={t('instructions')}
            htmlFor={`${uid}-instr`}
            hint={t('instructionsHint')}
            error={err('paymentInstructions')}
          >
            <Textarea
              id={`${uid}-instr`}
              rows={3}
              value={form.paymentInstructions}
              disabled={readOnly}
              invalid={!!err('paymentInstructions')}
              dir="auto"
              onChange={(e) => set('paymentInstructions', e.target.value)}
            />
          </Field>
        </div>
        <PrintPreview form={form} />
      </div>
    </Section>
  );
}

/** How the seller block, the bank rows and the notes read at the foot of an invoice. A paper stays white in the dark theme, as a printout does. */
function PrintPreview({ form }: { form: ProfileForm }) {
  const t = useTranslations('invoicing.settings.payment');
  const rows = normalizeRows(form.bankRows);
  const colour = /^#[0-9A-Fa-f]{6}$/.test(form.brandColor.trim())
    ? form.brandColor.trim()
    : '#334155';
  const title =
    form.invoiceTitle.trim() ||
    profileOf(form.sellerCountry)?.documentTitles['tax_invoice'] ||
    t('previewTitleDefault');
  const instructions = form.paymentInstructions.trim();
  const footer = form.footerNote.trim();
  return (
    <figure className="min-w-0 space-y-2" aria-label={t('previewLabel')}>
      <figcaption className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('previewLabel')}
      </figcaption>
      <div
        className="overflow-hidden rounded-lg border border-border bg-white text-slate-900 shadow-sm"
        style={{ borderTopColor: colour, borderTopWidth: 4 }}
      >
        <div className="space-y-3 p-4 text-xs leading-relaxed">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-semibold" dir="auto">
              {form.sellerName.trim() || t('previewSeller')}
            </p>
            <p
              className="shrink-0 text-sm font-bold uppercase tracking-wide"
              style={{ color: colour }}
              dir="auto"
            >
              {title}
            </p>
          </div>
          <div className="h-px bg-slate-200" />
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">
              {t('previewBank')}
            </p>
            {rows.length === 0 ? (
              <p className="text-slate-500">{t('previewNoBank')}</p>
            ) : (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                {rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-slate-500" dir="auto">
                      {r.label}
                    </dt>
                    <dd className="break-words font-medium" dir="auto">
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {instructions && (
            <p className="whitespace-pre-wrap break-words text-slate-700" dir="auto">
              {instructions}
            </p>
          )}
          {footer && (
            <p
              className="whitespace-pre-wrap break-words border-t border-slate-200 pt-2 text-slate-500"
              dir="auto"
            >
              {footer}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
    </figure>
  );
}
