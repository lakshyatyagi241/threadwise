'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  COMPLIANCE_REGIMES,
  effectivePolicy,
  type ComplianceRegime,
  type ComplianceSettings,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Field, Input, Switch } from '@crm/ui';
import { problemFor, toggleRegime, type Problem, type SettingsForm } from '../lib/model';
import { CARD, UrlField } from './fields';

/**
 * The profile picker. The country SUGGESTS profiles; nothing is on until a person saves a choice. Several can be on at once and the
 * strictest rule wins, which the summary below the list spells out. The extras of a profile (the CCPA opt-out, the DPDP consent
 * manager) appear when that profile is on.
 */
export function ProfilesTab({
  settings,
  form,
  patch,
  problems,
  canManage,
}: {
  settings: ComplianceSettings;
  form: SettingsForm;
  patch: (p: Partial<SettingsForm>) => void;
  problems: Problem[];
  canManage: boolean;
}) {
  const t = useTranslations('compliance-center.profiles');
  const { suggestion } = settings;
  const effective = effectivePolicy(form.regimes);
  const suggestionDiffers =
    suggestion.regimes.length > 0 &&
    [...suggestion.regimes].sort().join() !== [...form.regimes].sort().join();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {suggestion.regimes.length > 0 && suggestion.source !== null && (
        <Alert data-testid="suggestion" className="space-y-2">
          <p>
            {t('suggested', {
              country: suggestion.country ?? '',
              source: t(`source.${suggestion.source}`),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {suggestion.regimes.map((r) => (
              <Badge key={r} tone="success">
                {t(`items.${r}.name`)}
              </Badge>
            ))}
            {canManage && suggestionDiffers && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => patch({ regimes: [...suggestion.regimes] })}
                data-testid="use-suggestion"
              >
                {t('useSuggestion')}
              </Button>
            )}
          </div>
          <p className="text-xs">{t('suggestedNote')}</p>
        </Alert>
      )}
      {settings.regimesConfirmedAt === null && (
        <Alert tone="warning" data-testid="not-confirmed">
          {t('notConfirmed')}
        </Alert>
      )}

      <fieldset className={CARD} disabled={!canManage}>
        <legend className="px-1 text-sm font-semibold">{t('listTitle')}</legend>
        <ul className="mt-2 divide-y divide-border">
          {COMPLIANCE_REGIMES.map((r) => (
            <li key={r} className="py-3">
              <Checkbox
                id={`regime-${r}`}
                checked={form.regimes.includes(r)}
                label={t(`items.${r}.name`)}
                onChange={() => patch({ regimes: toggleRegime(form.regimes, r) })}
              />
              <p className="ms-7 mt-1 text-sm text-muted-foreground">{t(`items.${r}.summary`)}</p>
              <p className="ms-7 mt-1 text-xs text-muted-foreground">
                <span className="font-medium">{t('switchesOn')}</span> {t(`items.${r}.extras`)}
              </p>
            </li>
          ))}
        </ul>
      </fieldset>

      <EffectiveSummary regimes={form.regimes} effective={effective} />

      {form.regimes.includes('ccpa_us') && (
        <section className={CARD} data-testid="ccpa-extras">
          <h3 className="text-sm font-semibold">{t('ccpa.title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('ccpa.hint')}</p>
          <div className="mt-3 flex items-center gap-3">
            <Switch
              id="ccpa-offer"
              checked={form.offerSaleShareOptOut}
              onCheckedChange={(v) => patch({ offerSaleShareOptOut: v })}
              label={t('ccpa.offer')}
              disabled={!canManage}
            />
            <label htmlFor="ccpa-offer" className="text-sm">
              {t('ccpa.offer')}
            </label>
          </div>
          <div className="mt-3">
            <UrlField
              id="ccpa-url"
              label={t('ccpa.url')}
              hint={t('ccpa.urlHint')}
              value={form.optOutNoticeUrl}
              onChange={(v) => patch({ optOutNoticeUrl: v })}
              problem={problemFor(problems, 'optOutNoticeUrl')}
              disabled={!canManage}
            />
          </div>
        </section>
      )}

      {form.regimes.includes('dpdp_in') && (
        <section className={CARD} data-testid="dpdp-extras">
          <h3 className="text-sm font-semibold">{t('dpdp.title')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('dpdp.hint')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('dpdp.managerName')} htmlFor="cm-name">
              <Input
                id="cm-name"
                value={form.consentManager.name}
                maxLength={120}
                disabled={!canManage}
                onChange={(e) =>
                  patch({ consentManager: { ...form.consentManager, name: e.target.value } })
                }
              />
            </Field>
            <Field
              label={t('dpdp.managerRegistration')}
              htmlFor="cm-reg"
              hint={t('dpdp.managerRegistrationHint')}
            >
              <Input
                id="cm-reg"
                dir="ltr"
                value={form.consentManager.registrationId}
                maxLength={60}
                disabled={!canManage}
                onChange={(e) =>
                  patch({
                    consentManager: { ...form.consentManager, registrationId: e.target.value },
                  })
                }
              />
            </Field>
            <UrlField
              id="cm-url"
              label={t('dpdp.managerUrl')}
              value={form.consentManager.url}
              onChange={(v) => patch({ consentManager: { ...form.consentManager, url: v } })}
              problem={problemFor(problems, 'consentManager.url')}
              disabled={!canManage}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('dpdp.placeholderNote')}</p>
        </section>
      )}
    </div>
  );
}

function EffectiveSummary({
  regimes,
  effective,
}: {
  regimes: ComplianceRegime[];
  effective: ReturnType<typeof effectivePolicy>;
}) {
  const t = useTranslations('compliance-center.profiles.effective');
  return (
    <section className={CARD} data-testid="effective">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('hint')}</p>
      {regimes.length === 0 ? (
        <p className="mt-3 text-sm">{t('baselineOnly')}</p>
      ) : (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Item label={t('optIn')}>
            {effective.marketingOptIn ? t('optInYes') : t('optInNo')}{' '}
            {effective.marketingOptIn && (
              <Link
                href="/contact-consent"
                className="text-primary underline-offset-2 hover:underline"
              >
                {t('consentLink')}
              </Link>
            )}
          </Item>
          <Item label={t('requestDays')}>
            {effective.requestDays === null
              ? t('none')
              : t('days', { count: effective.requestDays })}
          </Item>
          <Item label={t('minorAge')}>
            {effective.minorAge === null ? t('none') : t('years', { count: effective.minorAge })}
          </Item>
          <Item label={t('callingWindow')}>
            {effective.callingWindow
              ? `${effective.callingWindow.start} - ${effective.callingWindow.end}`
              : t('none')}
          </Item>
          <Item label={t('dnd')}>
            {effective.dndRegistries.length === 0
              ? t('none')
              : effective.dndRegistries.map((d) => t(`registry.${d}`)).join(', ')}
          </Item>
        </dl>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('strictest')}</p>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
