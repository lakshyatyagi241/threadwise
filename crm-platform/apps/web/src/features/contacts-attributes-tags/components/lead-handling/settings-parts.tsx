'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner, Switch, cn } from '@crm/ui';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The shared pieces of the lead handling Settings pages (uncontacted leads, follow-ups, duplicate leads). */

export type SettingsErrorKey = 'network' | 'forbidden' | 'conflict' | 'validation' | 'unexpected';

/** The message key (under `leadHandling.settings.errors`) for a failed call. Branch on `code`, never on the server's wording. */
export function settingsErrorKey(error: unknown): SettingsErrorKey {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 403 || error.code === ERROR_CODES.FORBIDDEN) return 'forbidden';
  if (error.code === ERROR_CODES.ROW_VERSION_CONFLICT || error.status === 409) return 'conflict';
  if (error.code === ERROR_CODES.VALIDATION_FAILED || error.status === 400) return 'validation';
  return 'unexpected';
}

export const isVersionConflict = (e: unknown): boolean =>
  e instanceof ApiError && e.isRowVersionConflict;

/** A titled block of the page: a heading, one line saying what it does, then its controls. */
export function SettingsSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 border-b border-border pb-6 last:border-0">
      <div>
        <h2 id={id} className="text-xs font-bold uppercase tracking-wide">
          {title}
        </h2>
        {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** One on/off setting: its sentence on the left, the switch at the end of the row. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className={cn('text-sm', checked ? 'font-medium' : 'text-muted-foreground')}>
        {label}
      </label>
      <Switch id={id} label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** One choice of a group of radios. */
export function RadioRow({
  name,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 accent-[var(--primary)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className={checked ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Title, one-line help and the Discard / Save buttons shared by the settings pages. */
export function SettingsPage({
  title,
  subtitle,
  dirty,
  saving,
  onSave,
  onDiscard,
  children,
  error,
}: {
  title: string;
  subtitle: string;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  children: ReactNode;
  error?: ReactNode;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.settings');
  const id = useId();
  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-labelledby={id}>
      <header className="min-w-0">
        <h1 id={id} className="text-xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </header>
      <div className="space-y-6 rounded-xl border border-border bg-background p-5">{children}</div>
      {error}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="brand" disabled={!dirty || saving} onClick={onSave}>
          {saving && <Spinner />}
          {t('save')}
        </Button>
        <Button variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>
          {t('discard')}
        </Button>
      </div>
    </section>
  );
}

/** Loading, no-permission and load-error frames around a settings page. */
export function SettingsFrame({
  canManage,
  loading,
  error,
  onRetry,
  conflict,
  onConflictOk,
  children,
}: {
  canManage: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  conflict: boolean;
  onConflictOk: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.settings');
  if (!canManage) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
        <span>{t(`errors.${settingsErrorKey(error)}`)}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  if (loading) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  return (
    <>
      {conflict && (
        <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button size="sm" variant="secondary" onClick={onConflictOk}>
            {t('conflictOk')}
          </Button>
        </Alert>
      )}
      {children}
    </>
  );
}
