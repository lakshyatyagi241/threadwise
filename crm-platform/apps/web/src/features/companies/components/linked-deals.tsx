'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Spinner } from '@crm/ui';
import { useCompanyDeals } from '../api/companies';
import { openFirst } from '../lib/deals';
import { formatTotal } from '../lib/money';
import { ErrorLine } from './error-line';

const TONE = { won: 'success', lost: 'danger', open: 'neutral' } as const;

/**
 * The company's deals (WD-CTP-005): title, the stage as a chip coloured by the deal's status, and the value, which WaDesk printed
 * with no currency. Each row opens the deal itself (WaDesk linked to the board).
 */
export function LinkedDeals({ companyId }: { companyId: string }) {
  const t = useTranslations('companies.deals');
  const locale = useLocale();
  const list = useCompanyDeals(companyId, true);

  return (
    <section
      aria-labelledby="company-deals"
      className="space-y-3 rounded-md border border-border bg-background p-4"
    >
      <h2
        id="company-deals"
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        {t('title')}
        {list.isSuccess && (
          <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal">
            {list.items.length}
            {list.hasNextPage ? '+' : ''}
          </span>
        )}
      </h2>

      {list.isPending ? (
        <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </div>
      ) : list.isError ? (
        <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-1">
          {openFirst(list.items).map((d) => (
            <li key={d.id}>
              <Link
                href={`/deals/${d.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0 truncate text-sm font-medium" dir="auto">
                  {d.title}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={TONE[d.status]} title={t(`status.${d.status}`)}>
                    {d.stage.name}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {formatTotal({ currency: d.currency, amount: d.value }, locale)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage && <Spinner />}
          {t('loadMore')}
        </Button>
      )}
    </section>
  );
}
