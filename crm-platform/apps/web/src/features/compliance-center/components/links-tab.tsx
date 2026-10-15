'use client';

import { useTranslations } from 'next-intl';
import { problemFor, type Problem, type SettingsForm } from '../lib/model';
import { CARD, UrlField } from './fields';

/**
 * The workspace privacy and terms links. They are stored once here and offered, with one click, in the form builder's consent line and
 * in every consent-notice editor (chat widget, booking page, store, workspace default notice).
 */
export function LinksTab({
  form,
  patch,
  problems,
  canManage,
}: {
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  problems: Problem[];
  canManage: boolean;
}) {
  const t = useTranslations('compliance-center.links');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <section className={CARD}>
        <div className="grid gap-4 sm:grid-cols-2">
          <UrlField
            id="privacy-url"
            label={t('privacy')}
            hint={t('privacyHint')}
            value={form.privacyUrl}
            onChange={(v) => patch({ privacyUrl: v })}
            problem={problemFor(problems, 'privacyUrl')}
            disabled={!canManage}
          />
          <UrlField
            id="terms-url"
            label={t('terms')}
            hint={t('termsHint')}
            value={form.termsUrl}
            onChange={(v) => patch({ termsUrl: v })}
            problem={problemFor(problems, 'termsUrl')}
            disabled={!canManage}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('offered')}</p>
      </section>
    </div>
  );
}
