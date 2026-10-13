'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialState, WhatsappProviderStatus } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, PasswordInput, Spinner } from '@crm/ui';
import { NoAccess } from '@/features/roles-permissions/ui/states';
import { useMyPermissions } from '@/features/roles-permissions/ui/access';
import { ApiError } from '@/lib/api/errors';
import { isNoAccess, wapError, type WapError } from '../lib/errors';
import {
  missingPermission,
  wapAccess,
  type WapAccess,
  type WapPermissionName,
} from '../lib/permissions';
import { noSecret, secretHint, secretStatus, type SecretEdit } from '../lib/draft';

const NS = 'whatsapp-providers';

/** A titled card: the section a form step or a detail block lives in. */
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
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold">
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

export function LoadingBlock() {
  const t = useTranslations(`${NS}.common`);
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
      <Spinner label={t('loading')} />
      <span className="text-sm">{t('loading')}</span>
    </div>
  );
}

/** The sentence for an API failure, in the operator's language. */
export function useErrorText(): (e: unknown | WapError) => { text: string; requestId?: string } {
  const t = useTranslations(`${NS}.errors`);
  return (e) => {
    const info = isWapError(e) ? e : wapError(e);
    return { text: t(info.key, info.values), requestId: info.requestId };
  };
}

function isWapError(e: unknown): e is WapError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'key' in e;
}

/** A failed read or write: no-access for a permission refusal, otherwise the reason, the request id and (for a read) a retry. */
export function Failure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(`${NS}.common`);
  const text = useErrorText();
  if (isNoAccess(error)) {
    const permission = wapError(error).values?.permission;
    return <NoAccess permission={permission || undefined} />;
  }
  const { text: message } = text(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/**
 * Asks for the caller's own permission map first and shows the no-access page when a needed key is missing, so the operator never
 * triggers a denied request (each one is a logged security event). The server stays the authority.
 */
export function WapGate({
  need,
  children,
}: {
  need: readonly WapPermissionName[];
  children: (access: WapAccess) => ReactNode;
}) {
  const me = useMyPermissions();
  if (me.isPending) return <LoadingBlock />;
  if (me.isError) return <Failure error={me.error} onRetry={() => void me.refetch()} />;
  const access = wapAccess(me.data.permissions);
  const missing = missingPermission(access, need);
  if (missing) return <NoAccess permission={missing} />;
  return <>{children(access)}</>;
}

export function StatusBadge({ status }: { status: WhatsappProviderStatus }) {
  const t = useTranslations(`${NS}.status`);
  return (
    <Badge tone={status === 'active' ? 'success' : status === 'disabled' ? 'warning' : 'neutral'}>
      {t(status)}
    </Badge>
  );
}

export function DefaultBadge() {
  const t = useTranslations(`${NS}.status`);
  return <Badge tone="success">{t('default')}</Badge>;
}

export function BuiltinBadge() {
  const t = useTranslations(`${NS}.status`);
  return <Badge>{t('builtin')}</Badge>;
}

/**
 * A write-only field for a sealed credential. The stored value is never shown: a set secret reads "Set, ends in 1234", and typing
 * replaces it. A set secret can be cleared. Paste friendly: spaces and line breaks around a pasted value are trimmed on save.
 */
export function SecretField({
  label,
  hint,
  state,
  edit,
  onChange,
  error,
  disabled,
}: {
  label: string;
  hint?: string;
  /** What the API says is stored; null on a provider that does not exist yet. */
  state: CredentialState | null;
  edit: SecretEdit;
  onChange: (next: SecretEdit) => void;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations(`${NS}.secret`);
  const id = useId();
  const status = secretStatus(state ?? undefined, edit);
  const last4 = secretHint(state ?? undefined);
  const stored = !!state?.set && !edit.clear;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
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
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {status === 'setWithHint' ? t('setWithHint', { last4: last4 ?? '' }) : t(status)}
      </p>
    </Field>
  );
}

/** Reads a stored secret's state for display only (a read-only summary): "Set, ends in 1234" or "Not set". */
export function SecretState({ state }: { state: CredentialState }) {
  const t = useTranslations(`${NS}.secret`);
  const last4 = secretHint(state);
  return (
    <Badge tone={state.set ? 'success' : 'neutral'}>
      {state.set ? (last4 ? t('setWithHint', { last4 }) : t('set')) : t('notSet')}
    </Badge>
  );
}

/** Says why a mutation failed, next to the control that ran it. */
export function ErrorLine({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  const { text: message } = text(error);
  return (
    <Alert tone="danger" className="text-sm">
      <p>{message}</p>
    </Alert>
  );
}

export const isConflict = (e: unknown): boolean => e instanceof ApiError && e.isRowVersionConflict;
