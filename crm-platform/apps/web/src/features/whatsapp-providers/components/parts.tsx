'use client';

import { useId, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Card, Checkbox, Field, Input, PasswordInput } from '@crm/ui';
import { CopyButton } from '@/features/auth-registration-security/platform/ui/copy-button';
import type { Capabilities, CapabilityKey, ProviderHealth, ProviderStatus } from '../api/schemas';
import { CAPABILITY_KEYS } from '../api/schemas';
import { testFailureKind } from '../lib/errors';
import { healthView } from '../lib/health';
import { noSecret, secretHint, type SecretEdit } from '../lib/provider-draft';
import { webhookUrl } from '../lib/urls';

/** A titled card; the section a form step or a detail block lives in. */
export function Section({
  title,
  description,
  actions,
  children,
  tone,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'danger';
  id?: string;
}) {
  return (
    <Card
      id={id}
      className={tone === 'danger' ? 'space-y-4 border-danger/40' : 'space-y-4'}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2
            id={id ? `${id}-title` : undefined}
            className={`text-base font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}
          >
            {title}
          </h2>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function StatusChip({ status }: { status: ProviderStatus }) {
  const t = useTranslations('whatsapp-providers.status');
  return <Badge tone={status === 'active' ? 'success' : 'neutral'}>{t(status)}</Badge>;
}

export function DefaultBadge() {
  const t = useTranslations('whatsapp-providers.status');
  return <Badge tone="warning">{t('default')}</Badge>;
}

/** The last health check: when, and the result. */
export function HealthCell({ health }: { health: ProviderHealth | null }) {
  const t = useTranslations('whatsapp-providers.health');
  const tf = useTranslations('whatsapp-providers.test.failure');
  const format = useFormatter();
  const view = healthView(health);
  if (!health) return <span className="text-xs text-muted-foreground">{t('never')}</span>;
  return (
    <div className="space-y-0.5">
      <Badge tone={view.tone}>{t(view.kind)}</Badge>
      <p className="text-xs text-muted-foreground">
        <time dateTime={health.checkedAt}>{format.relativeTime(new Date(health.checkedAt))}</time>
        {!health.ok && health.code ? ` · ${tf(`${testFailureKind(health.code)}.title`)}` : ''}
      </p>
    </div>
  );
}

/**
 * A write-only field for a sealed credential. The stored value is never shown: a set secret reads "set" (with the last four
 * characters when the API offers them), and typing replaces it. Paste friendly: spaces and line breaks around a pasted token are
 * trimmed when the draft is turned into a request.
 */
export function SecretField({
  label,
  hint,
  state,
  edit,
  onChange,
  error,
  required,
  disabled,
}: {
  label: string;
  hint?: string;
  /** What the API says is stored; null on a provider that does not exist yet. */
  state: { set: boolean; last4?: string | null } | null;
  edit: SecretEdit;
  onChange: (next: SecretEdit) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('whatsapp-providers.secret');
  const id = useId();
  const last4 = state ? secretHint(state) : null;
  const stored = !!state?.set && !edit.clear;
  const status = edit.clear
    ? t('willClear')
    : edit.value.trim()
      ? t('willReplace')
      : stored
        ? last4
          ? t('setWithHint', { last4 })
          : t('set')
        : t('notSet');
  return (
    <Field
      label={
        <span>
          {label}
          {required && <span className="text-danger"> *</span>}
        </span>
      }
      htmlFor={id}
      hint={hint}
      error={error}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-60">
          <PasswordInput
            id={id}
            value={edit.value}
            onChange={(e) => onChange({ value: e.target.value, clear: false })}
            placeholder={stored ? t('placeholderKeep') : t('placeholderNew')}
            autoComplete="new-password"
            spellCheck={false}
            invalid={!!error}
            disabled={disabled || edit.clear}
            showLabel={t('show')}
            hideLabel={t('hide')}
            data-testid={`secret-${id}`}
          />
        </div>
        {state?.set && !disabled && (
          <button
            type="button"
            className="text-xs text-danger underline"
            onClick={() => onChange(edit.clear ? noSecret() : { value: '', clear: true })}
          >
            {edit.clear ? t('undoClear') : t('clear')}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <span aria-live="polite">{status}</span>
      </p>
    </Field>
  );
}

/** The URL the BSP or Meta is told to call, with a copy button. */
export function WebhookUrlRow({
  providerKey,
  label,
  base,
}: {
  providerKey: string;
  label: string;
  base?: string;
}) {
  const t = useTranslations('whatsapp-providers.webhooks');
  const id = useId();
  const { url, configured } = webhookUrl(providerKey, base);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} readOnly value={url} className="min-w-0 flex-1 basis-64 font-mono text-xs" />
        <CopyButton text={url} />
      </div>
      {!configured && <p className="text-xs text-warning">{t('baseMissing')}</p>}
    </div>
  );
}

const CAP_ORDER: readonly CapabilityKey[] = CAPABILITY_KEYS;

/** The capability tick list, with one line of help under each. `readOnly` shows the same list without the checkboxes' effect. */
export function CapabilityList({
  value,
  onChange,
  disabled,
}: {
  value: Capabilities;
  onChange: (next: Capabilities) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('whatsapp-providers.capabilities');
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {CAP_ORDER.map((k) => (
        <li key={k} className="rounded-md border border-border p-3">
          <Checkbox
            id={`cap-${k}`}
            checked={value[k]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
            label={
              <span>
                <span className="font-medium">{t(`items.${k}.label`)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(`items.${k}.help`)}
                </span>
              </span>
            }
          />
        </li>
      ))}
    </ul>
  );
}
