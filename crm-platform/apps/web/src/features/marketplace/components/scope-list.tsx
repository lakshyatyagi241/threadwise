'use client';

import { useTranslations } from 'next-intl';
import type { MarketScopeSummary } from '@crm/contracts';
import { Alert, Badge, cn } from '@crm/ui';
import { overallRisk, riskCounts, sortByRisk } from '../lib/consent';
import { ShieldIcon } from './icons';
import { RiskChip } from './ui';

/**
 * The permissions an app asks for, in plain words: the API's own label and description per scope and a risk chip, the riskiest first.
 * `added` marks the scopes that are new to the person (after a version asked for more, or after the list changed while they read it).
 */
export function ScopeList({
  scopes,
  added,
  className,
}: {
  scopes: readonly MarketScopeSummary[];
  added?: ReadonlySet<string>;
  className?: string;
}) {
  const t = useTranslations('marketplace.scopes');
  if (scopes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  }
  return (
    <ul className={cn('divide-y divide-border rounded-md border border-border', className)}>
      {sortByRisk(scopes).map((s) => (
        <li
          key={s.id}
          data-testid={`scope-${s.id}`}
          className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-3"
        >
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-sm font-medium">
              {s.label}
              {added?.has(s.id) && (
                <Badge tone="warning" className="ms-2 align-middle">
                  {t('new')}
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>
          </div>
          <RiskChip risk={s.risk} />
        </li>
      ))}
    </ul>
  );
}

const CALLOUT_TONE = { low: 'info', medium: 'warning', high: 'danger' } as const;

/** One sentence about the whole list, led by its highest risk. Nothing for an app that asks for nothing. */
export function RiskCallout({ scopes }: { scopes: readonly MarketScopeSummary[] }) {
  const t = useTranslations('marketplace.scopes');
  if (scopes.length === 0) return null;
  const risk = overallRisk(scopes);
  const counts = riskCounts(scopes);
  return (
    <Alert tone={CALLOUT_TONE[risk]} data-testid="risk-callout" className="flex items-start gap-2">
      <ShieldIcon className="mt-0.5" />
      <div>
        <p className="font-medium">{t(`overall.${risk}.title`)}</p>
        <p>{t(`overall.${risk}.message`)}</p>
        <p className="mt-1 text-xs">
          {t('counts', { high: counts.high, medium: counts.medium, low: counts.low })}
        </p>
      </div>
    </Alert>
  );
}
