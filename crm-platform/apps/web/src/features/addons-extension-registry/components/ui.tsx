'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, Button, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';

const NS = 'addons-extension-registry.common';

/** Title, one line of explanation and the page's actions; stacks on narrow screens. */
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-3xl space-y-1.5">
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function LoadingBlock() {
  const t = useTranslations(NS);
  return (
    <div className="flex min-h-40 items-center justify-center text-muted-foreground">
      <Spinner label={t('loading')} />
      <span className="ms-2 text-sm">{t('loading')}</span>
    </div>
  );
}

/** An API failure: a friendly sentence, the request id for support, and a retry. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(NS);
  const api = error instanceof ApiError ? error : null;
  const message =
    api?.status === 403
      ? t('errors.forbidden')
      : api && api.status < 500
        ? t('errors.request')
        : t('errors.unexpected');
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{message}</p>
      {api?.requestId && (
        <p className="text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{api.requestId}</span>
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
