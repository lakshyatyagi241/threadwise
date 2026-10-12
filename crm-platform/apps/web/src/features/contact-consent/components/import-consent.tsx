'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@crm/ui';

/**
 * The consent step of the contact import: "I have consent to message these contacts". Ticked, every contact in the file gets a
 * recorded consent with the file name as proof. Unticked, the import records none (the contacts stay "No consent recorded").
 */
export function ImportConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
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
      <p className="mt-1 ps-6 text-xs text-muted-foreground">{t('hint')}</p>
    </fieldset>
  );
}
