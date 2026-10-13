'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ConversationCloudGroup } from '@crm/contracts';
import { formatGroupCost } from '../lib/group-thread';

/**
 * Above the composer of a Meta Cloud API group thread (docs/specs/waba-groups-management.md 12 and D8): how many people one message
 * reaches and what that costs, because WhatsApp bills each member who receives it. The figure is an estimate (an upper bound: the
 * marketing rate for every member); the API checks the wallet again at send time. A short wallet warns here and does not switch the
 * composer off.
 */
export function GroupCostLine({ group }: { group: ConversationCloudGroup }) {
  const t = useTranslations('team-inbox-conversations.groupThread.cost');
  const locale = useLocale();
  const count = group.memberCount;
  const cost = group.estimate
    ? formatGroupCost(group.estimate.minor, group.estimate.currency, locale)
    : null;
  return (
    <div
      data-testid="inbox-group-cost"
      data-wallet-short={group.walletShort ? 'true' : 'false'}
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground"
    >
      <span>
        {count === 0
          ? t('sizeUnknown')
          : cost
            ? t('members', { count, cost })
            : t('membersNoEstimate', { count })}
      </span>
      {group.walletShort && (
        <span
          role="status"
          data-testid="inbox-group-wallet-short"
          className="font-medium text-danger"
        >
          {t('walletShort')}
        </span>
      )}
    </div>
  );
}
