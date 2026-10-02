'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PlatformWalletRow } from '@crm/contracts';
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Spinner, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { KEYS, operatorApi } from '../../api';
import { formatMinor } from '../../lib/money';
import { formatWhen } from '../customer/activity-table';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb } from './admin-parts';

/** Every workspace with its balance: search, low-balance filter, platform totals, and a link to each wallet. */
export function WorkspacesPage() {
  const t = useTranslations('wallet-message-billing.admin.workspaces');
  const tb = useTranslations('wallet-message-billing.admin');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [applied, setApplied] = useState({ q: '', lowOnly: false });

  const list = useInfiniteQuery({
    queryKey: [...KEYS.workspaces, applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorApi.workspaces({ q: applied.q || undefined, lowOnly: applied.lowOnly, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined),
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const first = list.data?.pages[0];
  const num = new Intl.NumberFormat(locale);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ q: q.trim(), lowOnly });
  };

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet'), href: '/admin/wallet' }, { label: t('crumb') }]} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
          <Field label={t('search')} htmlFor="ws-q" className="min-w-56 flex-1">
            <Input id="ws-q" type="search" maxLength={120} placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Checkbox id="ws-low" label={t('lowOnly')} checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="pb-2.5" />
          <Button type="submit">{t('apply')}</Button>
        </form>
      </Card>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : first ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label={t('totalWorkspaces')} value={num.format(first.totals.workspaces)} />
            <StatTile label={t('totalFloat')} value={formatMinor(first.totals.floatMinor, first.currency, locale)} />
            <StatTile label={t('totalLow')} value={num.format(first.totals.lowBalance)} tone={first.totals.lowBalance > 0 ? 'warning' : 'default'} />
          </div>
          {rows.length === 0 ? (
            <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
          ) : (
            <Card className="space-y-3">
              <WorkspaceTable rows={rows} />
              {list.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="secondary" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                    {list.isFetchingNextPage && <Spinner label={t('loadingMore')} />}
                    {t('loadMore')}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

export function WorkspaceTable({ rows }: { rows: readonly PlatformWalletRow[] }) {
  const t = useTranslations('wallet-message-billing.admin.workspaces.columns');
  const tm = useTranslations('wallet-message-billing.modes');
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm" aria-label={t('label')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">{t('workspace')}</th>
            <th scope="col" className="px-2 py-2 text-start font-medium">{t('mode')}</th>
            <th scope="col" className="px-2 py-2 text-end font-medium">{t('balance')}</th>
            <th scope="col" className="px-2 py-2 text-start font-medium">{t('activity')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.workspaceId} className="border-b border-border last:border-0">
              <td className="px-2 py-2">
                <Link href={`/admin/wallet/workspaces/${r.workspaceId}`} className="font-medium text-primary hover:underline">
                  {r.workspaceName}
                </Link>
                <div className="font-mono text-xs text-muted-foreground">{r.slug}</div>
              </td>
              <td className="px-2 py-2"><Badge>{tm(r.billingMode)}</Badge></td>
              <td className="whitespace-nowrap px-2 py-2 text-end tabular-nums">
                {formatMinor(r.balanceMinor, r.currency, locale)}
                {r.lowBalance && <Badge tone="warning" className="ms-2">{t('low')}</Badge>}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                {r.lastActivityAt ? formatWhen(r.lastActivityAt, locale) : t('never')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
