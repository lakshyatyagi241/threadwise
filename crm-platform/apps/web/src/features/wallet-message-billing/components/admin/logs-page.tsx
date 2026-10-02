'use client';

import Link from 'next/link';
import { Fragment, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery } from '@tanstack/react-query';
import { WALLET_LOG_EVENTS, type WalletLogQuery, type WalletLogRow } from '@crm/contracts';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Spinner } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { KEYS, operatorApi } from '../../api';
import { formatWhen } from '../customer/activity-table';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb } from './admin-parts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LogFilters {
  scope: 'all' | 'workspace' | 'platform';
  event: string;
  severity: '' | 'info' | 'warning' | 'error';
  workspaceId: string;
  q: string;
  from: string;
  to: string;
}
const EMPTY: LogFilters = {
  scope: 'all',
  event: '',
  severity: '',
  workspaceId: '',
  q: '',
  from: '',
  to: '',
};

/** The filters as the API query: only what is set; a workspace id that is not a uuid is not sent. */
export function toLogQuery(f: LogFilters): Partial<WalletLogQuery> {
  return {
    scope: f.scope,
    event: f.event || undefined,
    severity: f.severity || undefined,
    workspaceId: UUID.test(f.workspaceId.trim()) ? f.workspaceId.trim() : undefined,
    q: f.q.trim() || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
  };
}

/** The wallet trail: what happened to wallets and what operators changed, filterable, with each entry's payload. */
export function LogsPage() {
  const t = useTranslations('wallet-message-billing.admin.logs');
  const tb = useTranslations('wallet-message-billing.admin');
  const [draft, setDraft] = useState<LogFilters>(EMPTY);
  const [applied, setApplied] = useState<LogFilters>(EMPTY);
  const badId = draft.workspaceId.trim() !== '' && !UUID.test(draft.workspaceId.trim());
  const set = <K extends keyof LogFilters>(k: K, v: LogFilters[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const list = useInfiniteQuery({
    queryKey: [...KEYS.logs, applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      operatorApi.logs({ ...toLogQuery(applied), cursor: pageParam }, signal),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!badId) setApplied(draft);
  };

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet'), href: '/admin/wallet' }, { label: t('crumb') }]} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <form onSubmit={submit} role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('scope')} htmlFor="log-scope">
            <Select
              id="log-scope"
              value={draft.scope}
              onChange={(e) => set('scope', e.target.value as LogFilters['scope'])}
            >
              {(['all', 'workspace', 'platform'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`scopes.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('event')} htmlFor="log-event">
            <Select
              id="log-event"
              value={draft.event}
              onChange={(e) => set('event', e.target.value)}
            >
              <option value="">{t('anyEvent')}</option>
              {WALLET_LOG_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('severity')} htmlFor="log-sev">
            <Select
              id="log-sev"
              value={draft.severity}
              onChange={(e) => set('severity', e.target.value as LogFilters['severity'])}
            >
              <option value="">{t('anySeverity')}</option>
              {(['info', 'warning', 'error'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`severities.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('workspaceId')}
            htmlFor="log-ws"
            error={badId ? t('workspaceIdInvalid') : undefined}
          >
            <Input
              id="log-ws"
              autoComplete="off"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={draft.workspaceId}
              invalid={badId}
              onChange={(e) => set('workspaceId', e.target.value)}
            />
          </Field>
          <Field label={t('search')} htmlFor="log-q">
            <Input
              id="log-q"
              type="search"
              maxLength={120}
              value={draft.q}
              onChange={(e) => set('q', e.target.value)}
            />
          </Field>
          <Field label={t('from')} htmlFor="log-from">
            <Input
              id="log-from"
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(e) => set('from', e.target.value)}
            />
          </Field>
          <Field label={t('to')} htmlFor="log-to">
            <Input
              id="log-to"
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(e) => set('to', e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={badId}>
              {t('apply')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
              }}
            >
              {t('reset')}
            </Button>
          </div>
        </form>
      </Card>
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyBody')} />
      ) : (
        <Card className="space-y-3">
          <LogTable rows={rows} />
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage && <Spinner label={t('loadingMore')} />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const SEVERITY_TONE = { info: 'neutral', warning: 'warning', error: 'danger' } as const;

export function LogTable({
  rows,
  defaultOpen,
}: {
  rows: readonly WalletLogRow[];
  defaultOpen?: string;
}) {
  const t = useTranslations('wallet-message-billing.admin.logs');
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm" aria-label={t('title')}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.time')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.severity')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.event')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.workspace')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.actor')}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium">
              {t('columns.message')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expanded = open === r.id;
            const panel = `log-${r.id}`;
            return (
              <Fragment key={r.id}>
                <tr className="border-b border-border align-top">
                  <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                    {formatWhen(r.createdAt, locale)}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={SEVERITY_TONE[r.severity]}>{t(`severities.${r.severity}`)}</Badge>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.event}</td>
                  <td className="px-2 py-2">
                    {r.workspaceId ? (
                      <Link
                        href={`/admin/wallet/workspaces/${r.workspaceId}`}
                        className="text-primary hover:underline"
                      >
                        {r.workspaceName ?? r.workspaceId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t('platform')}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.actorLabel ??
                      t(
                        `actors.${r.actorType === 'platform_operator' ? 'operator' : r.actorType === 'user' ? 'customer' : 'system'}`,
                      )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panel}
                      onClick={() => setOpen(expanded ? null : r.id)}
                      className="text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {r.message}
                      <span className="ms-2 text-xs text-muted-foreground">
                        {expanded ? t('hideDetails') : t('showDetails')}
                      </span>
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr id={panel} className="border-b border-border bg-muted/40">
                    <td colSpan={6} className="px-3 py-3">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                      {r.requestId && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t('requestId')}: <span className="font-mono">{r.requestId}</span>
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
