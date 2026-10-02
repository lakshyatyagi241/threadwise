'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PricingMode } from '@crm/contracts';
import { Alert, Badge } from '@crm/ui';

/** Where the switch lives, so the banner can link straight to it. */
export const PRICING_MODE_HREF = '/admin/wallet/pricing#pricing-mode';

/**
 * The current pricing mode on a margins screen. In `fixed` mode the margins are saved but not used yet, said plainly with a
 * link to the switch; in `margin` mode they are what customers pay.
 */
export function PricingModeNote({ mode }: { mode: PricingMode }) {
  const t = useTranslations('wallet-message-billing.admin.margins.mode');
  const tm = useTranslations('wallet-message-billing.admin.pricing.mode');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('current')}</span>
        <Badge tone={mode === 'margin' ? 'success' : 'neutral'}>{tm(`${mode}.label`)}</Badge>
      </div>
      {mode === 'fixed' && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('inactive')}</span>
          <Link href={PRICING_MODE_HREF} className="font-medium underline">
            {t('switchLink')}
          </Link>
        </Alert>
      )}
    </div>
  );
}
