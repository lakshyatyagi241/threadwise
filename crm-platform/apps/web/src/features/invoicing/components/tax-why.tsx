'use client';

import { useTranslations } from 'next-intl';
import type { InvoiceResponse } from '@crm/contracts';
import { cn } from '@crm/ui';
import { regionOptions, splitPlace, type AutoTaxPreview } from '../lib/tax-info';

/** "India, Maharashtra (IN-MH)" for an ISO 3166-2 place of supply. */
function placeText(place: string): string {
  const { country, region } = splitPlace(place);
  const name = region ? regionOptions(country).find((r) => r.code === region)?.name : null;
  return name ? `${name} (${place})` : place;
}

interface WhyData {
  reasons: readonly string[];
  warnings: readonly string[];
  documentNotes: readonly string[];
  taxFree: boolean;
  placeOfSupply: string | null;
  reverseCharge: boolean;
}

function WhyPanel({
  data,
  preview,
  className,
}: {
  data: WhyData;
  preview?: boolean;
  className?: string;
}) {
  const t = useTranslations('invoicing.taxWhy');
  return (
    <section
      aria-label={t('title')}
      className={cn('rounded-lg border border-border bg-background p-4 text-sm', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('title')}
        </h2>
        {preview && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t('preview')}
          </span>
        )}
      </div>
      {preview && <p className="mt-1 text-xs text-muted-foreground">{t('previewNote')}</p>}
      {data.taxFree && (
        <p className="mt-2 inline-block rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {t('taxFree')}
        </p>
      )}
      {data.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 ps-5">
          {data.reasons.map((r) => (
            <li key={r} dir="auto">
              {r}
            </li>
          ))}
        </ul>
      )}
      {data.warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5">
          <div className="text-xs font-semibold">{t('warnings')}</div>
          <ul className="mt-1 list-disc space-y-1 ps-5">
            {data.warnings.map((w) => (
              <li key={w} dir="auto">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="mt-3 space-y-1.5 text-sm">
        {data.placeOfSupply && (
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted-foreground">{t('placeOfSupply')}</dt>
            <dd dir="ltr">{placeText(data.placeOfSupply)}</dd>
          </div>
        )}
        {data.reverseCharge && (
          <div>
            <dt className="font-medium">{t('reverseCharge')}</dt>
            <dd className="text-muted-foreground">{t('reverseChargeNote')}</dd>
          </div>
        )}
      </dl>
      {data.documentNotes.length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <div className="text-xs font-semibold text-muted-foreground">{t('documentNotes')}</div>
          <ul className="mt-1 space-y-1">
            {data.documentNotes.map((n) => (
              <li key={n} dir="auto" className="whitespace-pre-line">
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('disclaimer')}</p>
    </section>
  );
}

/**
 * "Why this tax?" of a SAVED invoice: what the tax engine decided for an automatic-tax invoice (the reasons, the warnings to
 * double-check, the wording the document prints) plus the place of supply and a reverse-charge note. Renders nothing for an invoice
 * priced from tax rates without a place of supply or reverse charge. The invoice detail embeds it.
 */
export function TaxWhy({ invoice }: { invoice: InvoiceResponse }) {
  const e = invoice.taxExplanation;
  if (!e && !invoice.reverseCharge && !invoice.placeOfSupply) return null;
  return (
    <WhyPanel
      data={{
        reasons: e?.reasons ?? [],
        warnings: e?.warnings ?? [],
        documentNotes: e?.documentNotes ?? [],
        taxFree: e?.taxFree ?? false,
        placeOfSupply: invoice.placeOfSupply,
        reverseCharge: invoice.reverseCharge,
      }}
    />
  );
}

/** The same reasoning computed in the browser while the form is edited (labelled as a preview: the server's answer wins after saving). */
export function TaxWhyPreview({
  preview,
  placeOfSupply,
  reverseCharge,
}: {
  preview: AutoTaxPreview;
  placeOfSupply: string | null;
  reverseCharge: boolean;
}) {
  return (
    <WhyPanel
      preview
      data={{
        reasons: preview.reasons,
        warnings: preview.warnings,
        documentNotes: preview.documentNotes,
        taxFree: preview.taxFree,
        placeOfSupply,
        reverseCharge,
      }}
    />
  );
}
