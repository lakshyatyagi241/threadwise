'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { AddonCard, WorkspaceAddonsResponse } from '@crm/contracts';
import { Alert, Badge, Card, EmptyState } from '@crm/ui';
import { KEYS, fetchWorkspaceAddons } from '../api';
import { ErrorBlock, LoadingBlock, PageHead } from './ui';

const NS = 'addons-extension-registry.workspace';

/** What a workspace sees: the add-ons it owns and the ones on sale. Buying belongs to checkout, so cards only state status. */
export function WorkspaceAddonsPage() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: KEYS.workspace,
    queryFn: ({ signal }) => fetchWorkspaceAddons(signal),
    refetchOnWindowFocus: false,
  });
  return (
    <div className="space-y-6">
      <PageHead title={t('title')} description={t('description')} />
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <Body data={q.data} />}
    </div>
  );
}

function Body({ data }: { data: WorkspaceAddonsResponse }) {
  const t = useTranslations(NS);
  const fmt = useFormatter();
  const money = (c: AddonCard, v: string) =>
    fmt.number(Number(v), { style: 'currency', currency: c.currency });

  return (
    <>
      <section className="space-y-3" aria-labelledby="owned-title">
        <h2 id="owned-title" className="text-lg font-semibold">
          {t('ownedTitle')}
        </h2>
        {data.owned.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('ownedNone')}</p>
        ) : (
          <ul className="space-y-2">
            {data.owned.map((o) => (
              <li key={o.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{o.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {o.endsAt
                      ? t('endsAt', {
                          date: fmt.dateTime(new Date(o.endsAt), { dateStyle: 'medium' }),
                        })
                      : t('lifetime')}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="catalog-title">
        <h2 id="catalog-title" className="text-lg font-semibold">
          {t('catalogTitle')}
        </h2>
        {!data.eligible ? (
          <Alert tone="info">{t('notEligible')}</Alert>
        ) : data.catalog.length === 0 ? (
          <EmptyState title={t('catalogTitle')} message={t('empty')} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.catalog.map((c) => (
              <li key={c.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold">{c.name}</h3>
                    {c.subtitle && <p className="text-sm text-muted-foreground">{c.subtitle}</p>}
                  </div>
                  <p className="text-xl font-semibold">
                    {c.isFree ? t('price.free') : money(c, c.offerAmount ?? c.amount)}
                    {c.offerAmount && !c.isFree && (
                      <span className="ms-2 text-sm font-normal text-muted-foreground line-through">
                        {money(c, c.amount)}
                      </span>
                    )}
                    {c.isLifetime && (
                      <span className="ms-2 text-xs font-normal text-muted-foreground">
                        {t('price.lifetime')}
                      </span>
                    )}
                  </p>
                  <ul className="flex-1 space-y-1 text-sm">
                    {c.grantBullets.map((b) => (
                      <li key={`${b.kind}-${b.key}`}>
                        {b.kind === 'feature'
                          ? t('bullets.feature', { name: b.key })
                          : b.kind === 'limit_unlimited'
                            ? t('bullets.unlimited', { name: b.key })
                            : t('bullets.add', { name: b.key, amount: b.amount ?? 0 })}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Badge tone={c.state === 'buy' ? 'neutral' : 'success'}>
                      {t(`state.${c.state === 'buy_again' ? 'buyAgain' : c.state}`)}
                    </Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
