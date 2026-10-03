'use client';

import { useId, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Field, Input, Select } from '@crm/ui';
import {
  AUTH_SCHEMES,
  BILLING_MODES,
  CREDENTIAL_MODES,
  ONBOARDING_KINDS,
  SIGNATURE_SCHEMES,
  WEBHOOK_MODES,
  type Provider,
} from '../api/schemas';
import {
  usesProviderToken,
  type DraftErrorCode,
  type DraftErrors,
  type ProviderDraft,
} from '../lib/provider-draft';
import type { PreviewValues } from '../lib/header-templates';
import { graphRoot } from '../lib/urls';
import { HeaderTemplatesEditor } from './header-templates-editor';
import { CapabilityList, SecretField, WebhookUrlRow } from './parts';

export interface SectionProps {
  draft: ProviderDraft;
  /** Merges a patch into the draft. */
  patch: (p: Partial<ProviderDraft>) => void;
  errors: DraftErrors;
  /** Messages the server attached to a field (422), shown when the local check passes. */
  serverErrors?: Record<string, string>;
  /** The stored provider when editing; null in the wizard. */
  existing: Provider | null;
  disabled?: boolean;
}

/** The message for a local validation code, under `whatsapp-providers.validation`. */
function useErrorText(errors: DraftErrors, serverErrors?: Record<string, string>) {
  const t = useTranslations('whatsapp-providers.validation');
  return (field: string): string | undefined => {
    const code: DraftErrorCode | undefined = errors[field];
    if (code) return t(code);
    return serverErrors?.[field];
  };
}

/** A select over a closed list with the help text of the chosen option under it. */
function EnumField<T extends string>({
  label,
  group,
  options,
  value,
  onChange,
  disabled,
  error,
  children,
}: {
  label: string;
  group: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  error?: string;
  children?: ReactNode;
}) {
  // The enum group is dynamic, so the key is not statically checkable.
  const t = useTranslations(`whatsapp-providers.enums.${group}`) as unknown as (
    key: string,
  ) => string;
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {t(`${o}.label`)}
          </option>
        ))}
      </Select>
      <p className="text-xs text-muted-foreground">{t(`${value}.help`)}</p>
      {children}
    </Field>
  );
}

/** Step 2: where the provider lives and how a call authenticates. */
export function ConnectionSection({
  draft,
  patch,
  errors,
  serverErrors,
  existing,
  disabled,
  previewValues,
}: SectionProps & { previewValues?: PreviewValues }) {
  const t = useTranslations('whatsapp-providers.connection');
  const err = useErrorText(errors, serverErrors);
  const ids = { key: useId(), label: useId(), base: useId(), version: useId() };
  const root = useMemo(
    () => (draft.baseUrl.trim() ? graphRoot(draft.baseUrl, draft.apiVersion) : ''),
    [draft.baseUrl, draft.apiVersion],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('label')} htmlFor={ids.label} hint={t('labelHint')} error={err('label')}>
          <Input
            id={ids.label}
            value={draft.label}
            maxLength={80}
            disabled={disabled}
            invalid={!!err('label')}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </Field>
        <Field
          label={t('key')}
          htmlFor={ids.key}
          hint={existing ? t('keyLocked') : t('keyHint')}
          error={err('key')}
        >
          <Input
            id={ids.key}
            value={draft.key}
            maxLength={40}
            dir="ltr"
            className="font-mono"
            disabled={disabled || !!existing}
            invalid={!!err('key')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => patch({ key: e.target.value.toLowerCase() })}
          />
        </Field>
        <Field
          label={t('baseUrl')}
          htmlFor={ids.base}
          hint={t('baseUrlHint')}
          error={err('baseUrl')}
          className="sm:col-span-2"
        >
          <Input
            id={ids.base}
            type="url"
            inputMode="url"
            dir="ltr"
            className="font-mono text-xs"
            value={draft.baseUrl}
            disabled={disabled}
            invalid={!!err('baseUrl')}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </Field>
        <Field
          label={t('apiVersion')}
          htmlFor={ids.version}
          hint={t('apiVersionHint')}
          error={err('apiVersion')}
        >
          <Input
            id={ids.version}
            value={draft.apiVersion}
            dir="ltr"
            className="font-mono"
            disabled={disabled}
            invalid={!!err('apiVersion')}
            placeholder="v23.0"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => patch({ apiVersion: e.target.value })}
          />
        </Field>
        {root && (
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">{t('rootTitle')}</p>
            <p dir="ltr" className="break-all rounded-md bg-muted/50 px-3 py-2 font-mono text-xs">
              {root}/&lt;path&gt;
            </p>
            <p className="text-xs text-muted-foreground">{t('rootHint')}</p>
          </div>
        )}
      </div>

      <EnumField
        label={t('authScheme')}
        group="authScheme"
        options={AUTH_SCHEMES}
        value={draft.authScheme}
        disabled={disabled}
        onChange={(authScheme) => patch({ authScheme })}
      />
      <HeaderTemplatesEditor
        rows={draft.headers}
        onChange={(headers) => patch({ headers })}
        authScheme={draft.authScheme}
        credentialMode={draft.credentialMode}
        previewValues={previewValues}
        disabled={disabled}
      />
      {err('headers') && (
        <p role="alert" className="text-sm text-danger">
          {err('headers')}
        </p>
      )}

      <EnumField
        label={t('credentialMode')}
        group="credentialMode"
        options={CREDENTIAL_MODES}
        value={draft.credentialMode}
        disabled={disabled}
        onChange={(credentialMode) => patch({ credentialMode })}
      >
        <CredentialModeExplainer mode={draft.credentialMode} />
      </EnumField>
    </div>
  );
}

/** What the credential mode means for the platform and for the customer, in plain words. */
function CredentialModeExplainer({ mode }: { mode: ProviderDraft['credentialMode'] }) {
  const t = useTranslations('whatsapp-providers.connection.modeExplainer');
  return (
    <Alert tone="info" className="mt-2 space-y-1">
      <p className="font-medium">{t(`${mode}.title`)}</p>
      <ul className="list-disc ps-5">
        <li>{t(`${mode}.platform`)}</li>
        <li>{t(`${mode}.customer`)}</li>
        <li>{t(`${mode}.failure`)}</li>
      </ul>
    </Alert>
  );
}

/** Step 3: the sealed credentials and how inbound webhooks are proven and delivered. */
export function CredentialsSection({
  draft,
  patch,
  errors,
  serverErrors,
  existing,
  disabled,
  urlBase,
}: SectionProps & { urlBase?: string }) {
  const t = useTranslations('whatsapp-providers.credentials');
  const tw = useTranslations('whatsapp-providers.webhooks');
  const err = useErrorText(errors, serverErrors);
  const headerId = useId();
  const sharedHeader = draft.signatureScheme === 'shared_secret_header';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Alert tone="info">{t('sealedNote')}</Alert>
        {usesProviderToken(draft) ? (
          <SecretField
            label={t('providerToken')}
            hint={t('providerTokenHint')}
            state={existing?.providerToken ?? null}
            edit={draft.providerToken}
            onChange={(providerToken) => patch({ providerToken })}
            error={err('providerToken')}
            required={!existing?.providerToken.set}
            disabled={disabled}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('channelTokenNote')}</p>
        )}
        <SecretField
          label={sharedHeader ? t('sharedSecret') : t('appSecret')}
          hint={sharedHeader ? t('sharedSecretHint') : t('appSecretHint')}
          state={existing?.appSecret ?? null}
          edit={draft.appSecret}
          onChange={(appSecret) => patch({ appSecret })}
          error={err('appSecret')}
          disabled={disabled}
        />
        <SecretField
          label={t('verifyToken')}
          hint={t('verifyTokenHint')}
          state={existing?.verifyToken ?? null}
          edit={draft.verifyToken}
          onChange={(verifyToken) => patch({ verifyToken })}
          error={err('verifyToken')}
          disabled={disabled}
        />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">{tw('title')}</h3>
        <EnumField
          label={tw('mode')}
          group="webhookMode"
          options={WEBHOOK_MODES}
          value={draft.webhookMode}
          disabled={disabled}
          onChange={(webhookMode) => patch({ webhookMode })}
        />
        <EnumField
          label={tw('signature')}
          group="signatureScheme"
          options={SIGNATURE_SCHEMES}
          value={draft.signatureScheme}
          disabled={disabled}
          onChange={(signatureScheme) => patch({ signatureScheme })}
        />
        {sharedHeader && (
          <Field
            label={tw('signatureHeader')}
            htmlFor={headerId}
            hint={tw('signatureHeaderHint')}
            error={err('signatureHeader')}
          >
            <Input
              id={headerId}
              value={draft.signatureHeader}
              dir="ltr"
              className="font-mono"
              disabled={disabled}
              invalid={!!err('signatureHeader')}
              placeholder="x-webhook-secret"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => patch({ signatureHeader: e.target.value })}
            />
          </Field>
        )}
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{tw('urlsTitle')}</p>
          <p className="text-xs text-muted-foreground">{tw('urlsHelp')}</p>
          <WebhookUrlRow providerKey={draft.key} label={tw('callbackUrl')} base={urlBase} />
          {draft.webhookMode === 'per_channel' && (
            <p className="text-xs text-muted-foreground">{tw('perChannelNote')}</p>
          )}
          {draft.verifyToken.value.trim() || existing?.verifyToken.set ? (
            <p className="text-xs text-muted-foreground">{tw('verifyNote')}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Step 4: who is billed for the messages, which calls the provider supports and how customers are onboarded. */
export function BillingSection({ draft, patch, errors, serverErrors, disabled }: SectionProps) {
  const t = useTranslations('whatsapp-providers.billing');
  const tc = useTranslations('whatsapp-providers.capabilities');
  const err = useErrorText(errors, serverErrors);
  const appId = useId();
  const configId = useId();
  return (
    <div className="space-y-6">
      <EnumField
        label={t('mode')}
        group="billingMode"
        options={BILLING_MODES}
        value={draft.billingMode}
        disabled={disabled}
        onChange={(billingMode) => patch({ billingMode })}
      />
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{tc('title')}</h3>
          <p className="text-sm text-muted-foreground">{tc('intro')}</p>
        </div>
        <CapabilityList
          value={draft.capabilities}
          disabled={disabled}
          onChange={(capabilities) => patch({ capabilities })}
        />
      </div>
      <div className="space-y-3">
        <EnumField
          label={t('onboarding')}
          group="onboarding"
          options={ONBOARDING_KINDS}
          value={draft.onboardingKind}
          disabled={disabled}
          onChange={(onboardingKind) => patch({ onboardingKind })}
        />
        {draft.onboardingKind === 'embedded_signup' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('appId')}
              htmlFor={appId}
              error={err('onboardingAppId')}
              hint={t('appIdHint')}
            >
              <Input
                id={appId}
                dir="ltr"
                className="font-mono"
                value={draft.onboardingAppId}
                disabled={disabled}
                invalid={!!err('onboardingAppId')}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => patch({ onboardingAppId: e.target.value })}
              />
            </Field>
            <Field label={t('configId')} htmlFor={configId} hint={t('configIdHint')}>
              <Input
                id={configId}
                dir="ltr"
                className="font-mono"
                value={draft.onboardingConfigId}
                disabled={disabled}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => patch({ onboardingConfigId: e.target.value })}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
