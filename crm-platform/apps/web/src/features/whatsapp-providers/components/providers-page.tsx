'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { WhatsappProvider } from '@crm/contracts';
import { Alert, Badge, EmptyState, Input, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { fetchProviders, wapKeys } from '../api';
import {
  CONSOLE_WHATSAPP_SETTINGS_PATH,
  STATUS_FILTERS,
  filterProviders,
  sortProviders,
  statusCounts,
  type StatusFilter,
} from '../lib/provider-view';
import type { WapAccess } from '../lib/permissions';
import { ProviderActionButtons, ProviderLinks } from './provider-actions';
import { BuiltinBadge, DefaultBadge, Failure, LoadingBlock, StatusBadge, WapGate } from './ui';

const NS = 'whatsapp-providers.list';

const linkClass =
  'inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';
const primaryLink =
  'inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary';

/** Operator console: the WhatsApp provider registry. Needs `platform.whatsapp_providers.view`. */
export function ProvidersPage() {
  return <WapGate need={['view']}>{(access) => <ProvidersList access={access} />}</WapGate>;
}

function ProvidersList({ access }: { access: WapAccess }) {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: wapKeys.list,
    queryFn: ({ signal }) => fetchProviders(signal),
    refetchOnWindowFocus: false,
  });
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const all = useMemo(() => sortProviders(q.data?.data ?? []), [q.data]);
  const counts = useMemo(() => statusCounts(all), [all]);
  const shown = useMemo(() => filterProviders(all, status, search), [all, status, search]);
  const defaultProvider = all.find((p) => p.isDefault) ?? null;

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <>
          <Link href={CONSOLE_WHATSAPP_SETTINGS_PATH} className={linkClass}>
            {t('consoleSettings')}
          </Link>
          {access.switch && (
            <Link href="/admin/whatsapp-providers/switch" className={linkClass}>
              {t('switchWorkspace')}
            </Link>
          )}
          {access.manage && (
            <Link href="/admin/whatsapp-providers/new" className={primaryLink}>
              {t('add')}
            </Link>
          )}
        </>
      }
    />
  );

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const workspaces = all.reduce((n, p) => n + p.workspaceCount, 0);
  const numbers = all.reduce((n, p) => n + p.numberCount, 0);

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('kpi.providers')} value={counts.all} />
        <StatTile label={t('kpi.active')} value={counts.active} tone="accent" />
        <StatTile label={t('kpi.numbers')} value={numbers} />
        <StatTile label={t('kpi.overrides')} value={workspaces} />
      </div>

      <Alert tone="info" className="space-y-1">
        {defaultProvider ? (
          <p>{t('defaultIs', { name: defaultProvider.label })}</p>
        ) : (
          <p>{t('noDefault')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('defaultHelp')}</p>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filterLabel')}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm ${
                status === s
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(`filters.${s}`)} <span className="tabular-nums">{counts[s]}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? t('emptyTitle') : t('noMatchTitle')}
          message={all.length === 0 ? t('emptyMessage') : t('noMatchMessage')}
          actions={
            all.length === 0 && access.manage ? (
              <Link href="/admin/whatsapp-providers/new" className={primaryLink}>
                {t('add')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ProvidersTable providers={shown} access={access} />
      )}
    </div>
  );
}

function ProvidersTable({
  providers,
  access,
}: {
  providers: WhatsappProvider[];
  access: WapAccess;
}) {
  const t = useTranslations(NS);
  const te = useTranslations('whatsapp-providers.enums');
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.provider')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.billing')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.credentials')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.usage')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.lastTest')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              <span className="sr-only">{t('cols.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {providers.map((p) => (
            <tr key={p.id} data-testid={`provider-${p.key}`}>
              <th scope="row" className="px-3 py-3 text-start font-normal">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/whatsapp-providers/${p.id}`}
                    className="font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {p.label}
                  </Link>
                  {p.isDefault && <DefaultBadge />}
                  {p.builtin && <BuiltinBadge />}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">{p.key}</div>
              </th>
              <td className="px-3 py-3">
                <StatusBadge status={p.status} />
              </td>
              <td className="px-3 py-3">{te(`billingMode.${p.billingMode}.label`)}</td>
              <td className="px-3 py-3">{te(`credentialMode.${p.credentialMode}.label`)}</td>
              <td className="px-3 py-3 text-end tabular-nums">
                <div>{t('usage.numbers', { count: p.numberCount })}</div>
                <div className="text-xs text-muted-foreground">
                  {t('usage.workspaces', { count: p.workspaceCount })}
                </div>
              </td>
              <td className="px-3 py-3">
                {p.lastTest ? (
                  <Badge tone={p.lastTest.ok ? 'success' : 'danger'}>
                    {p.lastTest.ok ? t('test.ok') : t('test.failed')}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('test.never')}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center justify-end gap-2">
                  <ProviderLinks provider={p} access={access} />
                  <ProviderActionButtons provider={p} access={access} layout="menu" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
