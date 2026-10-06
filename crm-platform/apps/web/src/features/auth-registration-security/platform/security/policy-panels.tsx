'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Textarea } from '@crm/ui';
import { normalizeIp, wouldLockOut } from '../lib/cidr';
import { appendEntry, parseList } from '../lib/list-text';
import { WORKSPACES_HREF } from '../lib/links';
import {
  AlertChannelControl,
  EnforcementBadge,
  GuardrailModeExplanation,
  GuardrailModeSelect,
  KeywordListControl,
  MfaMethodsControl,
  NumberControl,
  SettingsCard,
  ToggleControl,
} from './controls';
import { SECURITY_NS, fieldId, usePolicyForm } from './policy-form';

/** Every panel is one fieldset: for a read-only operator the browser disables everything inside it. */
function Panel({ className, children }: { className: string; children: React.ReactNode }) {
  const { readOnly } = usePolicyForm();
  return (
    <fieldset
      disabled={readOnly}
      className={`min-w-0 border-0 p-0 [&_input:disabled]:opacity-60 [&_select:disabled]:opacity-60 [&_textarea:disabled]:opacity-60 ${className}`}
    >
      {children}
    </fieldset>
  );
}

export function LoginPanel() {
  const t = useTranslations(`${SECURITY_NS}.panels.login`);
  return (
    <Panel className="grid items-start gap-5 lg:grid-cols-2">
      <SettingsCard kicker={t('lockout.kicker')} title={t('lockout.title')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberControl name="lockoutAfterFailures" />
          <NumberControl name="lockoutWindowMinutes" />
          <NumberControl name="passwordMaxAgeDays" />
          <NumberControl name="sessionTimeoutMinutes" />
        </div>
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <h3 className="text-sm font-semibold">{t('password.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('password.note')}</p>
          </div>
          <div className="grid grid-cols-2 items-end gap-3 2xl:grid-cols-4">
            <NumberControl name="passwordMinLength" />
            <ToggleControl name="passwordRequireUpper" compact />
            <ToggleControl name="passwordRequireNumber" compact />
            <ToggleControl name="passwordRequireSymbol" compact />
          </div>
          <ToggleControl name="rememberMeEnabled" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleControl name="alertOnNewDevice" />
          <ToggleControl name="alertOnNewCountry" />
        </div>
      </SettingsCard>

      <SettingsCard
        kicker={t('mfa.kicker')}
        title={t('mfa.title')}
        description={t('mfa.description')}
      >
        <div className="space-y-3">
          <ToggleControl name="requireMfaForAdmins" emphasis />
          <ToggleControl name="requireMfaForSuperAdmins" emphasis />
          <ToggleControl name="requireMfaForOwners" />
          <ToggleControl name="requireMfaForAll" />
          <MfaMethodsControl />
        </div>
      </SettingsCard>
    </Panel>
  );
}

export function WhatsappPanel() {
  const t = useTranslations(`${SECURITY_NS}.panels.whatsapp`);
  return (
    <Panel className="grid items-start gap-5 lg:grid-cols-3">
      <SettingsCard
        kicker={t('master.kicker')}
        title={t('master.title')}
        description={t('master.description')}
        className="lg:col-span-3"
        aside={<GuardrailModeSelect />}
      >
        <GuardrailModeExplanation />
      </SettingsCard>
      <SettingsCard kicker={t('caps.kicker')} title={t('caps.title')}>
        <div className="space-y-3">
          <NumberControl name="waMaxSendsPerMinute" />
          <NumberControl name="waMaxSendsPerDay" />
          <NumberControl name="waHoldOnLinksCount" />
        </div>
      </SettingsCard>
      <SettingsCard kicker={t('spam.kicker')} title={t('spam.title')}>
        <div className="space-y-3">
          <ToggleControl name="waHoldOnScamPattern" />
          <ToggleControl name="waRequireTemplateReview" />
        </div>
      </SettingsCard>
      <SettingsCard kicker={t('health.kicker')} title={t('health.title')}>
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          {t('health.body')}
        </p>
        <Link
          href={WORKSPACES_HREF}
          className="block rounded-full border border-border px-3 py-2 text-center text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('health.link')}
        </Link>
      </SettingsCard>
    </Panel>
  );
}

export function AbusePanel() {
  const t = useTranslations(`${SECURITY_NS}.panels.abuse`);
  return (
    <Panel className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <SettingsCard kicker={t('kicker')} title={t('title')}>
        <div className="space-y-3">
          <ToggleControl name="abuseBlockFinanceTerms" />
          <ToggleControl name="abuseBlockShortLinks" />
          <KeywordListControl />
        </div>
      </SettingsCard>
      <aside className="rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
        <p className="font-semibold">{t('aside.title')}</p>
        <p className="mt-1 text-muted-foreground">{t('aside.body')}</p>
      </aside>
    </Panel>
  );
}

/** The allowlist card: the toggle, one entry per line, and the caller's own address so they cannot lock themselves out. */
function AllowlistCard() {
  const t = useTranslations(`${SECURITY_NS}.panels.api.allowlist`);
  const { draft, setField, readOnly, errors, yourIp } = usePolicyForm();
  const mine = normalizeIp(yourIp);
  const entries = parseList(draft.ipAllowlistCidrs);
  const alreadyListed = mine !== null && entries.includes(mine);
  const lockout = wouldLockOut(yourIp, draft.ipAllowlistEnabled, entries);
  return (
    <SettingsCard kicker={t('kicker')} title={t('title')} description={t('description')}>
      <div className="space-y-3">
        <ToggleControl name="ipAllowlistEnabled" />
        <Field
          label={
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              {t('cidrs')}
              <EnforcementBadge name="ipAllowlistCidrs" />
            </span>
          }
          htmlFor={fieldId('ipAllowlistCidrs')}
          hint={t('cidrsHint')}
          error={errors.ipAllowlistCidrs}
        >
          <Textarea
            id={fieldId('ipAllowlistCidrs')}
            rows={4}
            value={draft.ipAllowlistCidrs}
            onChange={(e) => setField('ipAllowlistCidrs', e.target.value)}
            placeholder={t('placeholder')}
            readOnly={readOnly}
            invalid={Boolean(errors.ipAllowlistCidrs)}
            spellCheck={false}
            dir="ltr"
            className="resize-y font-mono"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          {mine ? (
            <>
              <span className="text-muted-foreground">{t('yourIp')}</span>
              <code dir="ltr" className="font-mono font-medium">
                {mine}
              </code>
              <Button
                size="sm"
                variant="secondary"
                className="ms-auto"
                disabled={readOnly || alreadyListed}
                onClick={() =>
                  setField('ipAllowlistCidrs', appendEntry(draft.ipAllowlistCidrs, mine))
                }
              >
                {alreadyListed ? t('alreadyListed') : t('addMine')}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">{t('yourIpUnknown')}</span>
          )}
        </div>
        {lockout && <Alert tone="warning">{t('lockoutWarning', { ip: mine ?? '' })}</Alert>}
      </div>
    </SettingsCard>
  );
}

export function ApiPanel() {
  const t = useTranslations(`${SECURITY_NS}.panels.api`);
  return (
    <Panel className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <SettingsCard kicker={t('traffic.kicker')} title={t('traffic.title')}>
        <div className="space-y-3">
          <NumberControl name="apiRateLimitPerMinute" />
          <NumberControl name="webhookReplayWindowSec" />
        </div>
      </SettingsCard>
      <SettingsCard kicker={t('integrity.kicker')} title={t('integrity.title')}>
        <ToggleControl name="webhookSignatureRequired" />
      </SettingsCard>
      <AllowlistCard />
    </Panel>
  );
}

export function DevicesPanel() {
  const t = useTranslations(`${SECURITY_NS}.panels.devices`);
  return (
    <Panel className="grid items-start gap-5 lg:grid-cols-2">
      <SettingsCard kicker={t('trust.kicker')} title={t('trust.title')}>
        <div className="space-y-3">
          <ToggleControl name="deviceTrustRequired" />
          <NumberControl name="deviceLogoutOnInactiveDays" />
          <NumberControl name="maxConcurrentSessions" />
        </div>
      </SettingsCard>
      <div className="space-y-5">
        <SettingsCard kicker={t('alerts.kicker')} title={t('alerts.title')}>
          <AlertChannelControl />
        </SettingsCard>
        <SettingsCard
          kicker={t('audit.kicker')}
          title={t('audit.title')}
          description={t('audit.description')}
        >
          <NumberControl name="auditLogRetentionDays" />
          <Link
            href="/admin/security/events"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('audit.link')}
          </Link>
        </SettingsCard>
      </div>
    </Panel>
  );
}
