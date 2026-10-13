'use client';

import { useTranslations } from 'next-intl';
import type { ContactImportPreview } from '@crm/contracts';
import { Alert, Checkbox } from '@crm/ui';

/**
 * The consent step of the contact import: "I have consent to message these contacts". Ticked, every contact in the file gets a
 * recorded consent with the file name as proof. Unticked, the import records none (the contacts stay "No consent recorded").
 *
 * With a column mapped to "Marketing consent", only the rows that say yes get a recorded consent; the summary says how many that is,
 * and the column does nothing until the box is ticked (the confirmation is always the person's own).
 */
export function ImportConsent({
  checked,
  onChange,
  summary = null,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** What the mapped consent column says (the preview's `consent`), or null when no column is mapped. */
  summary?: ContactImportPreview['consent'];
}) {
  const t = useTranslations('contact-consent.import');
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('legend')}
      </legend>
      <Checkbox
        id="import-consent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        label={t('label')}
      />
      <p className="mt-1 ps-6 text-xs text-muted-foreground">
        {summary ? t('hintColumn') : t('hint')}
      </p>
      {summary && (
        <div className="mt-2 space-y-2 ps-6" data-testid="import-consent-summary">
          <p className="text-xs">
            {t('columnSummary', {
              granted: summary.granted.toLocaleString(),
              notGranted: summary.notGranted.toLocaleString(),
            })}
          </p>
          {summary.unrecognised > 0 && (
            <Alert tone="warning">
              {t('unrecognised', {
                count: summary.unrecognised,
                values: summary.unrecognisedSamples.join(', '),
              })}
            </Alert>
          )}
          {!checked && summary.granted > 0 && <Alert tone="info">{t('columnIgnored')}</Alert>}
        </div>
      )}
    </fieldset>
  );
}
