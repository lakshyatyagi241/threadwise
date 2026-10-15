'use client';

import { useLocale, useTranslations } from 'next-intl';
import { INDIAN_NOTICE_LOCALES, type ComplianceSettings } from '@crm/contracts';
import { Alert, Badge, Field, Select } from '@crm/ui';
import { ConsentNoticeEditor } from '@/features/contact-consent';
import type { SettingsForm } from '../lib/model';
import { CARD } from './fields';

/** The name of a language in the language the person reads the app in (falls back to the code). */
export function languageName(code: string, uiLocale: string): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The workspace default notice: the wording the workspace shows next to a consent box, versioned (every change is a new numbered
 * version, so a record can name the exact text a person agreed to). English is always the first; the DPDP profile asks for a second
 * notice in an Indian language, which the person names here and saves with the settings.
 */
export function NoticesTab({
  settings,
  form,
  patch,
  canManage,
}: {
  settings: ComplianceSettings;
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  canManage: boolean;
}) {
  const t = useTranslations('compliance-center.notices');
  const uiLocale = useLocale();
  const dpdp = form.regimes.includes('dpdp_in');
  const saved = settings.secondaryNoticeLocale;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <ConsentNoticeEditor
        scope="workspace"
        refId="en"
        heading={t('english', { language: languageName('en', uiLocale) })}
      />

      <section className={CARD} data-testid="second-language">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('second.title')}</h3>
          {dpdp && <Badge tone="warning">{t('second.requiredByProfile')}</Badge>}
        </div>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{t('second.hint')}</p>
        <Field label={t('second.language')} htmlFor="second-locale">
          <Select
            id="second-locale"
            value={form.secondaryNoticeLocale}
            disabled={!canManage}
            onChange={(e) => patch({ secondaryNoticeLocale: e.target.value })}
          >
            <option value="">{t('second.none')}</option>
            {INDIAN_NOTICE_LOCALES.map((code) => (
              <option key={code} value={code}>
                {languageName(code, uiLocale)} ({code})
              </option>
            ))}
          </Select>
        </Field>
        {form.secondaryNoticeLocale !== (saved ?? '') && (
          <Alert className="mt-3">{t('second.saveFirst')}</Alert>
        )}
      </section>

      {saved !== null && form.secondaryNoticeLocale === saved && (
        <ConsentNoticeEditor
          key={saved}
          scope="workspace"
          refId={saved}
          heading={t('secondEditor', { language: languageName(saved, uiLocale) })}
        />
      )}
    </div>
  );
}
