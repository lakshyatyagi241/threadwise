'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { AddonCard, OperatorWorkspaceAddonsResponse } from '@crm/contracts';
import { Badge } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { formatMoney } from '@/features/plans-subscriptions-trials/lib/format';
import { fetchWorkspaceAddons, hubKeys } from '../api';

type Tone = 'success' | 'warning' | 'neutral';

/** Why one add-on is on or off for this workspace: the plan, a purchase, an override, or nothing (docs/specs/addons-plan-offers.md 3). */
export function addonSource(
  card: AddonCard,
  overrides: Record<string, boolean>,
  platformOwned: boolean,
): { key: 'plan' | 'override' | 'platform' | 'bought' | 'buy' | 'unavailable'; tone: Tone } {
  if (card.state === 'included') {
    if (card.includedVia !== 'support') return { key: 'plan', tone: 'success' };
    // The card does not say which keys made it free; an override switched ON is the likely reason, else platform-owned status.
    return platformOwned && !Object.values(overrides).some((v) => v === true)
      ? { key: 'platform', tone: 'neutral' }
      : { key: 'override', tone: 'warning' };
  }
  if (card.state === 'active' || card.state === 'buy_again')
    return { key: 'bought', tone: 'success' };
  if (card.state === 'buy') return { key: 'buy', tone: 'neutral' };
  return { key: 'unavailable', tone: 'neutral' };
}

/**
 * The Plan tab's "Add-ons" block: every plain add-on with what this workspace has and why. An override is the only thing that beats the plan, so
 * it is called out; the "Edit & change plan" dialog clears it.
 */
export function WorkspaceAddonsBlock({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('workspaces-hub.detail.planTab.addons');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useQuery({
    queryKey: hubKeys.addons(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceAddons(workspaceId, signal),
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const data: OperatorWorkspaceAddonsResponse = q.data;
  const overrideKeys = Object.keys(data.featureOverrides);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(iso));

  return (
    <section aria-labelledby="hub-addons-title" className="space-y-3">
      <div>
        <h3 id="hub-addons-title" className="text-sm font-medium">
          {t('title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('intro')}</p>
      </div>
      {data.catalog.length === 0 && data.hidden.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.catalog.map((card) => {
            const src = addonSource(card, data.featureOverrides, data.platformOwned);
            return (
              <li
                key={card.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{card.name}</p>
                  <p className="text-xs text-muted-foreground">{t(`kind.${card.kind}`)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={src.tone}>{t(`source.${src.key}`)}</Badge>
                  {src.key === 'bought' && (
                    <span className="text-muted-foreground">
                      {card.ownedEndsAt
                        ? t(card.ownedRenews ? 'renews' : 'ends', { date: date(card.ownedEndsAt) })
                        : t('lifetime')}
                    </span>
                  )}
                  {src.key === 'buy' && (
                    <span className="tabular-nums text-muted-foreground">
                      {formatMoney(card.offerAmount ?? card.amount, card.currency, locale)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {data.hidden.map((h) => (
            <li
              key={h.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <p className="truncate text-sm font-medium text-muted-foreground">{h.name}</p>
              <Badge tone="neutral">{t('source.hidden')}</Badge>
            </li>
          ))}
        </ul>
      )}
      {overrideKeys.length > 0 && (
        <p className="text-sm text-warning" role="note">
          {t('overrides', { count: overrideKeys.length, keys: overrideKeys.join(', ') })}
        </p>
      )}
    </section>
  );
}
