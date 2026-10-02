'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AddonCard, WorkspaceAddonsResponse } from '@crm/contracts';
import { Card } from '@crm/ui';
import { KEYS, fetchWorkspaceAddons } from '../api';
import { ErrorBlock, LoadingBlock } from './ui';

const NS = 'addons-extension-registry.workspace';

const Tick = ({ className }: { className: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M3 8.5l3.5 3.5L13 5" />
  </svg>
);

const Panel = ({ title, body, aside }: { title: string; body: string; aside?: string }) => (
  <div className="flex items-center justify-between border-b border-border px-5 py-4">
    <div>
      <h2 className="font-serif text-xl leading-tight">{title}</h2>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{body}</p>
    </div>
    {aside && (
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {aside}
      </span>
    )}
  </div>
);

/**
 * What a workspace sees (WD-ADD-033), laid out like WaDesk's Account > Add-ons tab: the add-ons it owns, then the
 * ones on sale. Visibility is decided by the API (`eligible`), not by this screen.
 */
export function WorkspaceAddonsPage() {
  const q = useQuery({
    queryKey: KEYS.workspace,
    queryFn: ({ signal }) => fetchWorkspaceAddons(signal),
    refetchOnWindowFocus: false,
  });
  const t = useTranslations(NS);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </header>
      {q.isPending && <LoadingBlock />}
      {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <Body data={q.data} />}
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="rounded-2xl p-8 text-center">
      <h2 className="font-serif text-xl">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-muted-foreground">{body}</p>
      {action}
    </Card>
  );
}

function Body({ data }: { data: WorkspaceAddonsResponse }) {
  const t = useTranslations(NS);
  const fmt = useFormatter();

  if (!data.eligible)
    return (
      <Empty
        title={t('needPlanTitle')}
        body={t('needPlanBody')}
        action={
          <Link
            href="/account/plans"
            className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {t('viewPlans')}
          </Link>
        }
      />
    );
  if (data.catalog.length === 0) return <Empty title={t('noneTitle')} body={t('noneBody')} />;

  return (
    <div className="space-y-5">
      {data.owned.length > 0 && (
        <Card className="overflow-hidden rounded-2xl border-success/40 p-0">
          <Panel title={t('ownedTitle')} body={t('ownedBody')} />
          <ul className="divide-y divide-border">
            {data.owned.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{o.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {o.endsAt
                      ? t('ends', {
                          date: fmt.dateTime(new Date(o.endsAt), { dateStyle: 'medium' }),
                        })
                      : t('lifetime')}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
                  {t('active')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden rounded-2xl p-0">
        <Panel
          title={t('catalogTitle')}
          body={t('catalogBody')}
          aside={t('count', { count: data.catalog.length })}
        />
        <ul className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.catalog.map((c) => (
            <li key={c.id} className="flex">
              <CatalogCard card={c} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CatalogCard({ card: c }: { card: AddonCard }) {
  const t = useTranslations(NS);
  const fmt = useFormatter();
  const price =
    c.isFree || Number(c.amount) === 0
      ? t('free')
      : fmt.number(Number(c.offerAmount ?? c.amount), { style: 'currency', currency: c.currency });
  const period = c.isLifetime
    ? t('lifetimePrice')
    : t('per', { unit: t(`units.${c.billingUnit}`) });

  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl border border-border p-5 transition hover:border-primary/40">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('cardEyebrow')}
      </div>
      <h3 className="font-serif text-lg leading-tight">{c.name}</h3>
      {c.subtitle && (
        <p className="text-[11.5px] leading-snug text-muted-foreground">{c.subtitle}</p>
      )}
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-serif text-3xl leading-none">{price}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{period}</span>
      </div>
      {c.grantBullets.length > 0 && (
        <ul className="mt-1 space-y-1 text-xs">
          {c.grantBullets.map((b) => (
            <li key={`${b.kind}-${b.key}`} className="flex items-start gap-1.5">
              <Tick className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                {b.kind === 'feature'
                  ? t('bullets.feature', { name: b.label })
                  : b.kind === 'limit_unlimited'
                    ? t('bullets.unlimited', { name: b.label })
                    : t('bullets.add', { amount: b.amount ?? 0, name: b.label })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {c.state === 'active' ? (
        <span className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-primary/10 px-3 py-2.5 text-xs font-semibold text-primary">
          <Tick className="size-3.5" />
          {t('active')}
        </span>
      ) : (
        <>
          <Link
            href={`/billing/checkout/${c.slug}`}
            className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
          >
            {c.state === 'buy_again' ? t('buyAgain') : t('buy')}
            <svg
              viewBox="0 0 16 16"
              className="size-3 rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </Link>
          {c.state === 'buy_again' && (
            <div className="mt-1 text-center text-[10.5px] text-muted-foreground">
              {t('owned', { count: c.ownedCount })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
