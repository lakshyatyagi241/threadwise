'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useWalletBalance } from './use-wallet-balance';

/** The balance as a pill that leads to the wallet. Renders nothing for a member who may not read the balance. */
export function WalletBalanceChip({ className }: { className?: string }) {
  const t = useTranslations('wallet-message-billing.chip');
  const { allowed, label, lowBalance } = useWalletBalance();
  if (!allowed || label === null) return null;
  return (
    <Link
      href="/billing/wallet"
      title={lowBalance ? t('low') : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        lowBalance ? 'border-warning/50' : 'border-border',
        className,
      )}
    >
      <span className="text-muted-foreground">{t('balance')}</span>
      <span className={cn('tabular-nums', lowBalance && 'text-warning')}>{label}</span>
    </Link>
  );
}
