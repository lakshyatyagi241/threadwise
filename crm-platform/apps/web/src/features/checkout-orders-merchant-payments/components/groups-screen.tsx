'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { StoreGroup } from '@crm/contracts';
import { Input } from '@crm/ui';
import { StoreShell } from '@/features/storefront-builder';
import { useGroupSummary, useGroups } from '../api/hooks';
import { formatInt, formatWhen, displayPhone } from '../lib/format';
import { CopyButton, GroupCodeEditor } from './groups-code-editor';
import { useUrlParam } from './groups-url-state';
import {
  ErrorPanel,
  LinkButton,
  LoadMore,
  NoAccess,
  PageHeader,
  Skeleton,
  TableSkeleton,
  Th,
  useStoreCan,
} from './parts';

/** `/store/groups` (WaDesk store groups): the WhatsApp group directory with each group's ordering code. */
export function GroupsScreen() {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  const can = useStoreCan('groups');
  return (
    <StoreShell>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
      {can.read ? <GroupsBody canManage={can.manage} /> : <NoAccess />}
    </StoreShell>
  );
}

function GroupsBody({ canManage }: { canManage: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  const search = useUrlParam('q', 300);
  const q = search.applied.trim();
  const summary = useGroupSummary();
  const list = useGroups({ q: q || undefined });
  const bot = summary.data?.botNumber ?? null;

  return (
    <>
      <SummaryStrip summary={summary} />

      <div className="rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <Input
              type="search"
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.label')}
              maxLength={120}
            />
          </div>
        </div>

        <div className="p-4">
          {list.isPending ? (
            <TableSkeleton label={t('loading')} />
          ) : list.isError ? (
            <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
          ) : list.items.length === 0 ? (
            <EmptyGroups searching={q !== ''} />
          ) : (
            <>
              <GroupsTable
                items={list.items}
                bot={bot}
                canManage={canManage}
                onStale={() => void list.refetch()}
              />
              <LoadMore
                hasMore={Boolean(list.hasNextPage)}
                loading={list.isFetchingNextPage}
                onMore={() => void list.fetchNextPage()}
              />
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
        <div className="mb-1 font-semibold text-foreground">{t('how.title')}</div>
        {t('how.body')}
      </div>
    </>
  );
}

function SummaryStrip({ summary }: { summary: ReturnType<typeof useGroupSummary> }) {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  const locale = useLocale();
  const data = summary.data;
  const bot = displayPhone(data?.botNumber);

  if (summary.isError) {
    return <ErrorPanel error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile label={t('summary.groups')}>
        {data ? formatInt(data.total, locale) : <Skeleton className="h-8 w-16" />}
      </Tile>
      <Tile label={t('summary.coded')}>
        {data ? formatInt(data.coded, locale) : <Skeleton className="h-8 w-16" />}
      </Tile>
      <Tile label={t('summary.bot')}>
        {!data ? (
          <Skeleton className="h-6 w-32" />
        ) : bot ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span dir="ltr" className="font-mono text-base">
              {bot}
            </span>
            <CopyButton text={bot} label={t('summary.copyNumber')} />
          </div>
        ) : (
          <div className="space-y-1 text-sm font-normal">
            <p className="text-muted-foreground">{t('summary.noBot')}</p>
            <Link
              href={'/channels'}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('summary.connect')}
            </Link>
          </div>
        )}
      </Tile>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold leading-tight">{children}</div>
    </div>
  );
}

function EmptyGroups({ searching }: { searching: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  if (searching) {
    return (
      <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
        <div className="text-lg font-semibold">{t('noMatch.title')}</div>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t('noMatch.message')}</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
      <div className="text-lg font-semibold">{t('empty.title')}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{t('empty.message')}</p>
      <div className="mt-5 flex justify-center">
        <LinkButton href={'/channels'} variant="secondary">
          {t('empty.action')}
        </LinkButton>
      </div>
    </div>
  );
}

function GroupsTable({
  items,
  bot,
  canManage,
  onStale,
}: {
  items: StoreGroup[];
  bot: string | null;
  canManage: boolean;
  onStale: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  const locale = useLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <Th>{t('columns.group')}</Th>
            <Th>{t('columns.members')}</Th>
            <Th>{t('columns.device')}</Th>
            <Th>{t('columns.synced')}</Th>
            <Th>{t('columns.code')}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((g) => (
            <tr key={g.id} className="align-top hover:bg-muted/40">
              <td className="px-4 py-3">
                <div className="font-semibold">{g.subject?.trim() || t('row.unnamed')}</div>
                <div
                  dir="ltr"
                  className="mt-0.5 max-w-[14rem] truncate text-start font-mono text-[11px] text-muted-foreground"
                  title={g.jid}
                >
                  {g.jid}
                </div>
              </td>
              <td className="px-4 py-3">{formatInt(g.size, locale)}</td>
              <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                {displayPhone(g.devicePhone) || '—'}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatWhen(g.syncedAt, locale) || '—'}
              </td>
              <td className="px-4 py-3">
                <GroupCodeEditor
                  key={`${g.id}:${g.rowVersion}`}
                  group={g}
                  botNumber={bot}
                  canManage={canManage}
                  onStale={onStale}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
