'use client';

import { cn } from '@crm/ui';
import { useTranslations } from 'next-intl';
import type { WspMembersSummary } from '@crm/contracts';
import { TIER_DOT, visibleTiers, type FilterTier } from '../lib/roles';
import { InfoIcon } from './icons';

/** Sidebar of the Members screen: role filter pills with live counts, and the "How roles work" card. */
export function RoleFilter({
  summary,
  value,
  onChange,
}: {
  summary: WspMembersSummary | undefined;
  value: FilterTier;
  onChange: (tier: FilterTier) => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.members');
  const tt = useTranslations('workspaces-teams-tenancy.tiers');
  return (
    <aside className="space-y-3">
      <nav aria-label={t('filterBy')} className="rounded-md border border-border bg-background p-2">
        <div className="px-3 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('filterBy')}
        </div>
        {visibleTiers(summary).map((tier) => {
          const active = tier === value;
          const count = summary?.counts[tier];
          return (
            <button
              key={tier}
              type="button"
              aria-pressed={active}
              data-testid={`role-filter-${tier}`}
              onClick={() => onChange(tier)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm',
                active
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              <span className="flex items-center gap-2">
                {tier !== 'all' && (
                  <span aria-hidden="true" className={cn('size-2 rounded-full', TIER_DOT[tier])} />
                )}
                {t(`filters.${tier}`)}
              </span>
              <span
                data-testid={`role-count-${tier}`}
                className={cn(
                  'font-mono text-[11px]',
                  active ? 'opacity-90' : 'text-muted-foreground',
                )}
              >
                {count ?? '–'}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-xs leading-relaxed">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <InfoIcon className="size-3 text-primary" />
          {t('howTitle')}
        </div>
        <div className="space-y-1.5">
          {(['owner', 'admin', 'manager', 'agent', 'viewer'] as const).map((tier) => (
            <div key={tier}>
              <span className="font-semibold">{tt(tier)}</span> — {t(`how.${tier}`)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
