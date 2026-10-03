'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';
import { LockIcon } from '../../ui/icons';
import { isForbidden, wsError } from '../lib/errors';
import { useCan } from '@/features/auth-registration-security/shared/session-context';

const NS = 'roles-permissions-workspace.common';

export function LoadingBlock() {
  const t = useTranslations(NS);
  return (
    <div
      className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground"
      role="status"
    >
      <Spinner label={t('loading')} />
      <span className="text-sm">{t('loading')}</span>
    </div>
  );
}

/** The person may not use this screen: a clear page, not a crash and not a bare 403. */
export function NoAccess({ permission }: { permission?: string }) {
  const t = useTranslations('roles-permissions-workspace.common.noAccess');
  return (
    <div
      role="alert"
      data-testid="no-access"
      className="mx-auto mt-10 max-w-lg space-y-3 rounded-2xl border border-border bg-background p-8 text-center"
    >
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <LockIcon className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">
        {permission ? t('bodyWithKey', { permission }) : t('body')}
      </p>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('back')}
      </Link>
    </div>
  );
}

/** Renders `children` only when the session holds the key; the server still answers for itself (a 403 lands in NoAccess too). */
export function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  return allowed ? <>{children}</> : <NoAccess permission={permission} />;
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  const te = useTranslations('roles-permissions-workspace.errors');
  const info = wsError(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{info.detail ?? te(info.key, info.values)}</p>
      {info.requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{info.requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** A failed read: no-access for a permission refusal, otherwise the reason, the request id and a retry. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isForbidden(error)) return <NoAccess />;
  return <ErrorNote error={error} onRetry={onRetry} />;
}
