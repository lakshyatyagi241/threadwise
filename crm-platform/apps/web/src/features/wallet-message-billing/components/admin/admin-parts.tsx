'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';

/** Writes (settings, rates, adjustments, reconciliation) are for super admins; the API enforces it, the UI just does not offer it. */
export function useCanWrite(): boolean {
  return useOperator().canRunDanger;
}

export function ReadOnlyBanner() {
  const t = useTranslations('wallet-message-billing.admin');
  const { operator } = useOperator();
  return <Alert tone="info">{t('readOnly', { role: operator.role.replace(/_/g, ' ') })}</Alert>;
}

/** Admin > Wallet > Page, as links; the last crumb is the current page. */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  const t = useTranslations('wallet-message-billing.admin');
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
            <span aria-hidden="true">&gt;</span>
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
