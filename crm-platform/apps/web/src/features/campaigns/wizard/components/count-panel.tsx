'use client';

import { useTranslations } from 'next-intl';
import type { WizardAudienceCount } from '@crm/contracts';
import { Alert, cn } from '@crm/ui';
import { ErrorBlock, Skeleton } from './parts';

export interface CountQuery {
  data?: WizardAudienceCount;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
}

const nf = (n: number) => n.toLocaleString();

/**
 * "Matching contacts": who the draft's groups, segments and conditions select, who is always skipped (opted out, no valid number)
 * and who will be messaged. The numbers are the API's, computed by the same function the send uses.
 */
export function CountPanel({
  count,
  hasSource,
  updating,
  compact,
}: {
  count: CountQuery;
  /** Anything selects contacts yet. */
  hasSource: boolean;
  /** A newer audience is waiting to be counted. */
  updating: boolean;
  /** Beside other content: no sticky positioning, tighter padding. */
  compact?: boolean;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const data = count.data;
  const busy = updating || (count.isFetching && !count.isPending);
  const about = (n: number, approximate: boolean) =>
    approximate ? t('about', { count: n }) : nf(n);

  return (
    <aside
      aria-label={t('countTitle')}
      aria-busy={busy || count.isPending}
      className={cn(
        'shrink-0 rounded-xl border border-border bg-background',
        !compact && 'lg:sticky lg:top-4',
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between gap-2 border-b border-border px-4',
          compact ? 'py-2' : 'py-3',
        )}
      >
        <h2 className="text-base font-semibold">{t('countTitle')}</h2>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {busy ? t('updating') : ''}
        </span>
      </header>
      <div className={cn('space-y-3', compact ? 'p-3' : 'p-4')}>
        {!hasSource ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('countIdle')}</p>
        ) : count.isPending ? (
          <Skeleton label={t('countLoading')} lines={4} />
        ) : count.isError && !data ? (
          <ErrorBlock error={count.error} onRetry={() => void count.refetch()} />
        ) : data ? (
          <div className={cn('space-y-3 transition-opacity', busy && 'opacity-60')}>
            {count.isError && (
              <ErrorBlock error={count.error} onRetry={() => void count.refetch()} />
            )}
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt>{t('matching')}</dt>
                <dd className="font-medium tabular-nums">
                  {about(data.matching, data.approximate)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>{t('optedOut')}</dt>
                <dd className="tabular-nums">{about(data.optedOut, data.approximate)}</dd>
              </div>
              {data.noConsent > 0 && (
                <div className="flex justify-between gap-3 text-muted-foreground">
                  <dt>{t('noConsent')}</dt>
                  <dd className="tabular-nums">{about(data.noConsent, data.approximate)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>{t('invalidNumbers')}</dt>
                <dd className="tabular-nums">{about(data.invalidNumber, data.approximate)}</dd>
              </div>
              {data.newContacts > 0 && (
                <div className="flex justify-between gap-3 text-muted-foreground">
                  <dt>{t('newNumbers')}</dt>
                  <dd className="tabular-nums">{nf(data.newContacts)}</dd>
                </div>
              )}
            </dl>
            {!compact && <p className="text-xs text-muted-foreground">{t('alwaysSkipped')}</p>}
            <div className="rounded-lg bg-brand/10 px-3 py-2.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('willBeMessaged')}
              </div>
              <div
                className={cn('font-semibold tabular-nums', compact ? 'text-2xl' : 'text-3xl')}
                data-testid="recipients"
              >
                {about(data.recipients, data.approximate)}
              </div>
            </div>
            {data.approximate && (
              <p className="text-xs text-muted-foreground">{t('approximate')}</p>
            )}
            {data.recipients === 0 && <Alert tone="warning">{t('nobody')}</Alert>}
            {data.invalidConditions.length > 0 && (
              <Alert tone="warning">
                {t('invalidConditions', { count: data.invalidConditions.length })}
              </Alert>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
