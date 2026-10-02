'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { WALLET_CATEGORIES, type MessagePricing } from '@crm/contracts';
import { Badge, Card } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, customerApi } from '../../api';
import { formatMinor } from '../../lib/money';
import { ErrorState } from '../state';

/**
 * "Message pricing": the base price of each category, shown only while the workspace pays per message (in plan mode the
 * plan covers the messages and nothing is shown). Mounted by the templates page.
 */
export function MessagePricingPanel({
  country,
  compact = false,
}: {
  /** ISO country of the audience, for the exact price of that country; omitted = the base rates. */
  country?: string;
  compact?: boolean;
}) {
  const allowed = useCan('wallet.balance.read');
  const q = useQuery({
    queryKey: KEYS.pricing(country),
    queryFn: ({ signal }) => customerApi.pricing(country, signal),
    enabled: allowed,
  });
  if (!allowed || q.isPending) return null;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.billingMode !== 'wallet') return null;
  return <PricingTiles pricing={q.data} compact={compact} />;
}

export function PricingTiles({ pricing, compact }: { pricing: MessagePricing; compact: boolean }) {
  const t = useTranslations('wallet-message-billing.pricingPanel');
  const tc = useTranslations('wallet-message-billing.categories');
  const locale = useLocale();
  const byCategory = new Map(pricing.categories.map((c) => [c.category, c] as const));
  return (
    <Card className="space-y-3" aria-label={t('title')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Badge>{t('badge')}</Badge>
      </div>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {WALLET_CATEGORIES.map((cat) => {
          const row = byCategory.get(cat);
          return (
            <li key={cat} className="rounded-md border border-border p-3" data-category={cat}>
              <div className="text-xs font-medium text-muted-foreground">{tc(cat)}</div>
              {!row || row.free ? (
                <>
                  <div className="mt-1 text-lg font-semibold">{t('free')}</div>
                  <div className="text-xs text-muted-foreground">{t('noCharge')}</div>
                </>
              ) : (
                <>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {formatMinor(row.priceMinor, pricing.currency, locale)}
                  </div>
                  <div className="text-xs text-muted-foreground">{t('perMessage')}</div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {!compact && <p className="text-xs text-muted-foreground">{t('footer')}</p>}
    </Card>
  );
}
