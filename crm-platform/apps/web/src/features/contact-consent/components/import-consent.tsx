'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { ContactImportPreview } from '@crm/contracts';
import { Alert, Checkbox, Field, Input, Textarea } from '@crm/ui';

/** The notice a file's contacts agreed under, as the importer states it (kept as proof beside each recorded consent). */
export interface ImportNotice {
  text: string;
  version: string;
}

type Summary = ContactImportPreview['consent'];

/**
 * The consent step of the contact import and of the broadcast wizard's CSV: "I have consent to message these contacts". Ticked, every
 * contact in the file gets a recorded consent with the file name as proof, and (BL-170) the notice or lawful basis the importer states
 * with its version. Unticked, nothing is recorded (the contacts stay "No consent recorded").
 *
 * With a column mapped to "Marketing consent", only the rows that say yes get a recorded consent; the summary says how many that is,
 * and the column does nothing until the box is ticked (the confirmation is always the person's own). The SMS and email columns work the
 * same way and are the only way a file records those channels.
 */
export function ImportConsent({
  checked,
  onChange,
  summary = null,
  smsSummary = null,
  emailSummary = null,
  notice,
  onNotice,
  scope = 'contacts',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** What the mapped consent column says (the preview's `consent`), or null when no column is mapped. */
  summary?: Summary;
  /** The same for the SMS and email consent columns (the preview's `consentSms` / `consentEmail`). */
  smsSummary?: Summary;
  emailSummary?: Summary;
  /** The stated notice and its version; the fields show once the box is ticked. */
  notice?: ImportNotice;
  onNotice?: (n: ImportNotice) => void;
  /** `numbers`: the broadcast wizard's CSV, whose numbers become contacts when the broadcast launches. */
  scope?: 'contacts' | 'numbers';
}) {
  const t = useTranslations('contact-consent.import');
  const numbers = scope === 'numbers';
  const uid = useId();
  return (
    <fieldset className="rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('legend')}
      </legend>
      <Checkbox
        id={numbers ? 'csv-consent' : 'import-consent'}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        label={numbers ? t('labelNumbers') : t('label')}
      />
      <p className="mt-1 ps-6 text-xs text-muted-foreground">
        {numbers ? t('hintNumbers') : summary ? t('hintColumn') : t('hint')}
      </p>
      {checked && notice && onNotice && (
        <div className="mt-3 space-y-3 ps-6" data-testid="import-consent-notice">
          <Field label={t('noticeText')} hint={t('noticeTextHint')} htmlFor={`${uid}-text`}>
            <Textarea
              id={`${uid}-text`}
              rows={2}
              maxLength={2000}
              value={notice.text}
              onChange={(e) => onNotice({ ...notice, text: e.target.value })}
            />
          </Field>
          <Field label={t('noticeVersion')} htmlFor={`${uid}-version`}>
            <Input
              id={`${uid}-version`}
              maxLength={64}
              value={notice.version}
              onChange={(e) => onNotice({ ...notice, version: e.target.value })}
            />
          </Field>
        </div>
      )}
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
      {smsSummary && (
        <p className="mt-2 ps-6 text-xs" data-testid="import-consent-sms">
          {t('smsSummary', {
            granted: smsSummary.granted.toLocaleString(),
            notGranted: smsSummary.notGranted.toLocaleString(),
          })}
        </p>
      )}
      {emailSummary && (
        <p className="mt-2 ps-6 text-xs" data-testid="import-consent-email">
          {t('emailSummary', {
            granted: emailSummary.granted.toLocaleString(),
            notGranted: emailSummary.notGranted.toLocaleString(),
          })}
        </p>
      )}
    </fieldset>
  );
}
