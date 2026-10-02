'use client';

import type { ComponentProps } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { useWalletBalance } from './use-wallet-balance';

/** The signed-in shell with its balance chip fed from the live wallet balance (the shell's own `wallet` hook point). */
export function WalletAppShell(props: ComponentProps<typeof AppShell>) {
  const { label } = useWalletBalance();
  return <AppShell {...props} wallet={label ? { label, href: '/billing/wallet' } : props.wallet} />;
}
