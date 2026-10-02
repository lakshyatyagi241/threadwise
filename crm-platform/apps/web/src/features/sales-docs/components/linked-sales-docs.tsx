'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Spinner, cn } from '@crm/ui';
import { useLinkedDocs } from '../api/hooks';
import { isUnavailable } from '../lib/errors';
import { docHref, KIND_META, newDocHref } from '../lib/kinds';
import { formatMoney } from '../lib/money';
import { effectiveStatus } from '../lib/status';
import { ErrorLine, StatusChip, useSalesDocsCan, useToday } from './parts';

export interface LinkedSalesDocsProps {
  /** The record whose proposals and estimates are listed; a new one is linked to it. */
  kind: 'contact' | 'deal';
  id: string;
  /** A short heading style for narrow panels (the deal drawer). */
  compact?: boolean;
  className?: string;
}

/**
 * The proposals and estimates of one contact or deal, newest first, with "New proposal" and "New estimate" that start linked
 * to the record. Shared by the contact page and the deal drawer so both behave the same. Renders nothing for someone who may
 * not read sales documents.
 */
export function LinkedSalesDocs(props: LinkedSalesDocsProps) {
  const can = useSalesDocsCan();
  if (!can.read) return null;
  return <Panel {...props} canCreate={can.create} />;
}

function Panel({
  kind,
  id,
  compact,
  className,
  canCreate,
}: LinkedSalesDocsProps & { canCreate: boolean }) {
  const t = useTranslations('sales-docs.linked');
  const locale = useLocale();
  const today = useToday();
  const docs = useLinkedDocs({ kind, id }, true);
  const heading = `linked-sales-docs-${kind}-${id}`;
  const link = kind === 'contact' ? { contact: id } : { deal: id };
  const chip =
    'rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <section
      aria-labelledby={heading}
      className={cn(
        compact
          ? 'space-y-3'
          : 'space-y-3 rounded-md border border-border bg-background p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={heading}
          className={cn(
            compact
              ? 'text-sm font-semibold'
              : 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
          )}
        >
          {t('title')}
          {docs.isSuccess && (
            <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-muted-foreground">
              {docs.data.length}
            </span>
          )}
        </h2>
        {canCreate && (
          <div className="flex gap-1.5">
            <Link href={newDocHref('proposal', link)} className={chip}>
              + {t('newProposal')}
            </Link>
            <Link href={newDocHref('estimate', link)} className={chip}>
              + {t('newEstimate')}
            </Link>
          </div>
        )}
      </div>

      {docs.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : docs.isError ? (
        isUnavailable(docs.error) ? (
          <EmptyState title={t('unavailableTitle')} message={t('unavailable')} />
        ) : (
          <ErrorLine error={docs.error} onRetry={() => void docs.refetch()} />
        )
      ) : docs.data.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {docs.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={docHref(d.kind, d.id)}
                  className="block truncate text-sm font-medium outline-none hover:text-primary hover:underline focus-visible:underline"
                  dir="auto"
                >
                  <span className="font-mono text-[13px]">{d.number}</span>
                  {d.title ? <span className="text-muted-foreground"> · {d.title}</span> : null}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                  <StatusChip status={effectiveStatus(d, today)} />
                  <span className="text-muted-foreground">{t(`kind.${d.kind}`)}</span>
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums" dir="ltr">
                {formatMoney(d.totalMinor, d.currency, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {(['proposal', 'estimate'] as const).map((k) => (
          <Link
            key={k}
            href={`${KIND_META[k].base}?${kind}=${id}`}
            className="text-brand underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none dark:text-primary"
          >
            {t(k === 'proposal' ? 'viewProposals' : 'viewEstimates')}
          </Link>
        ))}
      </div>
    </section>
  );
}
