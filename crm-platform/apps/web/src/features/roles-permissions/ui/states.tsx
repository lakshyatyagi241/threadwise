'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { isNoAccess, rbacError } from '../lib/errors';
import { LockIcon } from './icons';

const NS = 'roles-permissions.common';

export function LoadingBlock({ className }: { className?: string }) {
  const t = useTranslations(NS);
  return (
    <div
      className={
        className ?? 'flex min-h-64 items-center justify-center gap-2 text-muted-foreground'
      }
    >
      <Spinner label={t('loading')} />
      <span className="text-sm">{t('loading')}</span>
    </div>
  );
}

/** The operator may not use this screen: a clear page, not a crash and not a bare 403. */
export function NoAccess({ permission }: { permission?: string }) {
  const t = useTranslations(`${NS}.noAccess`);
  return (
    <div
      role="alert"
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
        href="/admin"
        className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('back')}
      </Link>
    </div>
  );
}

/** A failed read: no-access for a permission refusal, otherwise the reason in plain words, the request id and a retry. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  const te = useTranslations(`${NS}.errors`);
  if (isNoAccess(error)) {
    const permission = rbacError(error).values?.permission;
    return <NoAccess permission={permission || undefined} />;
  }
  const info = rbacError(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{te(info.key, info.values)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}
