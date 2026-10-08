'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { WabaConnection, WabaGroupsState } from '@crm/contracts';
import { Badge, Card } from '@crm/ui';
import { cardTitle } from '../lib/display';

/**
 * Reference's left rail: the number with its Eligible badge, the number switcher (only when there is more than one), and the "How groups
 * work" note. Groups belong to a number, not to a workspace.
 */
export function GroupNumberRail({
  account,
  numbers,
  state,
}: {
  account: WabaConnection | null;
  numbers: readonly WabaConnection[];
  state: WabaGroupsState | undefined;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups.rail');
  return (
    <aside className="space-y-3">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('title')}
          </span>
          {account && state && (
            <Badge tone={state.eligible ? 'success' : 'neutral'}>
              {state.eligible ? t('eligible') : t('notEligible')}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground" dir="ltr">
          {account?.phoneNumber || t('noNumber')}
        </p>
      </Card>

      {numbers.length > 1 && (
        <Card className="p-2">
          <p className="px-2 py-2 text-xs uppercase tracking-wide text-muted-foreground">
            {t('numberLabel')}
          </p>
          {numbers.map((n) => (
            <Link
              key={n.id}
              href={`/waba-groups?account=${n.id}`}
              aria-current={account?.id === n.id ? 'page' : undefined}
              className={`block truncate rounded-md px-2 py-2 text-sm ${
                account?.id === n.id ? 'bg-muted font-semibold' : 'hover:bg-muted'
              }`}
            >
              {n.displayLabel || cardTitle(n) || n.phoneNumber}
            </Link>
          ))}
        </Card>
      )}

      <div className="rounded-md border border-success/30 bg-success/5 p-4 text-sm leading-relaxed">
        <p className="mb-1 font-semibold">{t('howTitle')}</p>
        <p className="text-muted-foreground">{t('howInvite')}</p>
        <p className="mt-2 text-muted-foreground">{t('howCost')}</p>
      </div>
    </aside>
  );
}
