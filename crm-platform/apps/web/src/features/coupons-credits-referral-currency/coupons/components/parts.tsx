'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { couponErrorKind, requestIdOf } from '../lib/errors';

export const NS = 'coupons-credits-referral-currency.coupons';

/** Writes are for super admins (the API enforces it); the UI just does not offer them to other roles. */
export function useCanWrite(): boolean {
  return useOperator().canRunDanger;
}

export function ReadOnlyBanner() {
  const t = useTranslations(`${NS}.common`);
  const { operator } = useOperator();
  return <Alert tone="info">{t('readOnly', { role: operator.role.replace(/_/g, ' ') })}</Alert>;
}

/** Admin > Coupons > Page; the last crumb is the current page. */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  const t = useTranslations(`${NS}.common`);
  return (
    <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/admin" className="hover:underline">
            {t('admin')}
          </Link>
        </li>
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="rtl:rotate-180">
              &gt;
            </span>
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-mono text-foreground">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LoadingBlock() {
  const t = useTranslations(`${NS}.common`);
  return (
    <div
      role="status"
      className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Spinner label={t('loading')} />
      {t('loading')}
    </div>
  );
}

/** An API failure as a friendly sentence chosen by the problem code, the request id for support, and a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations(`${NS}.errors`);
  const tc = useTranslations(`${NS}.common`);
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className="space-y-2">
      <p>{t(couponErrorKind(error))}</p>
      {requestId && (
        <p className="text-xs opacity-80">
          {tc('requestId')}: <span className="font-mono">{requestId}</span>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {tc('retry')}
        </Button>
      )}
    </Alert>
  );
}
