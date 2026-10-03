'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, Card, EmptyState, StatTile } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useProviders, useWapAccess } from '../api/hooks';
import type { Provider } from '../api/schemas';
import { baseHost } from '../lib/urls';
import { HelpPanel } from './help-panel';
import { DefaultBadge, HealthCell, StatusChip } from './parts';
import { ProviderActions } from './provider-actions';

/** Provider list: the registry of every WhatsApp provider the platform can send through. */
export function ProvidersPage() {
  const t = useTranslations('whatsapp-providers.list');
  const q = useProviders();
  const { access, ready } = useWapAccess();

  const providers = q.data?.data ?? [];
  const active = providers.filter((p) => p.status === 'active').length;
  const channels = providers.reduce((n, p) => n + p.channelCount, 0);
  const def = providers.find((p) => p.isDefault);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Link href="/admin/whatsapp-providers/assignments">
              <Button variant="secondary" size="sm">
                {t('assignments')}
              </Button>
            </Link>
            {access.switch && (
              <Link href="/admin/whatsapp-providers/switch">
                <Button variant="secondary" size="sm">
                  {t('switch')}
                </Button>
              </Link>
            )}
            {access.manage && (
              <Link href="/admin/whatsapp-providers/new">
                <Button size="sm">{t('add')}</Button>
              </Link>
            )}
          </>
        }
      />

      {ready && !access.view && <Alert tone="warning">{t('noAccess')}</Alert>}
      {ready && access.view && !access.manage && <Alert tone="info">{t('readOnly')}</Alert>}

      <HelpPanel />

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : providers.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyMessage')}
          actions={
            access.manage ? (
              <Link href="/admin/whatsapp-providers/new">
                <Button>{t('add')}</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('kpi.total')} value={providers.length} />
            <StatTile label={t('kpi.active')} value={active} tone="accent" />
            <StatTile label={t('kpi.channels')} value={channels} />
            <StatTile label={t('kpi.default')} value={def?.label ?? '—'} />
          </div>
          <div className="hidden md:block">
            <ProviderTable providers={providers} access={access} />
          </div>
          <ul className="space-y-3 md:hidden">
            {providers.map((p) => (
              <li key={p.id}>
                <ProviderCard provider={p} access={access} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProviderTable({
  providers,
  access,
}: {
  providers: Provider[];
  access: ReturnType<typeof useWapAccess>['access'];
}) {
  const t = useTranslations('whatsapp-providers.list');
  const te = useTranslations('whatsapp-providers.enums');
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">{t('title')}</caption>
        <thead className="bg-muted/50 text-start text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {(
              [
                'provider',
                'adapter',
                'host',
                'credentials',
                'billing',
                'status',
                'channels',
                'health',
                'actions',
              ] as const
            ).map((c) => (
              <th key={c} scope="col" className="px-3 py-2.5 text-start font-medium">
                {t(`columns.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {providers.map((p) => (
            <tr key={p.id} data-testid={`provider-row-${p.key}`} className="align-top">
              <td className="px-3 py-3">
                <Link
                  href={`/admin/whatsapp-providers/${p.id}`}
                  className="font-medium hover:underline"
                >
                  {p.label}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {p.key}
                  </span>
                  {p.isDefault && <DefaultBadge />}
                </div>
              </td>
              <td className="px-3 py-3">{te(`adapterKind.${p.adapterKind}.label`)}</td>
              <td className="px-3 py-3">
                <span dir="ltr" className="font-mono text-xs">
                  {baseHost(p.baseUrl)}
                </span>
                <div dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {p.apiVersion}
                </div>
              </td>
              <td className="px-3 py-3">{te(`credentialMode.${p.credentialMode}.label`)}</td>
              <td className="px-3 py-3">{te(`billingMode.${p.billingMode}.label`)}</td>
              <td className="px-3 py-3">
                <StatusChip status={p.status} />
              </td>
              <td className="px-3 py-3 tabular-nums">{p.channelCount}</td>
              <td className="px-3 py-3">
                <HealthCell health={p.lastHealth} />
              </td>
              <td className="px-3 py-3">
                <ProviderActions provider={p} access={access} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderCard({
  provider: p,
  access,
}: {
  provider: Provider;
  access: ReturnType<typeof useWapAccess>['access'];
}) {
  const t = useTranslations('whatsapp-providers.list');
  const te = useTranslations('whatsapp-providers.enums');
  return (
    <Card className="space-y-3" data-testid={`provider-card-${p.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/whatsapp-providers/${p.id}`} className="font-medium hover:underline">
            {p.label}
          </Link>
          <p dir="ltr" className="font-mono text-xs text-muted-foreground">
            {p.key} · {baseHost(p.baseUrl)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.isDefault && <DefaultBadge />}
          <StatusChip status={p.status} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t('columns.credentials')}</dt>
          <dd>{te(`credentialMode.${p.credentialMode}.label`)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('columns.billing')}</dt>
          <dd>{te(`billingMode.${p.billingMode}.label`)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('columns.channels')}</dt>
          <dd>
            <Badge>{p.channelCount}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('columns.health')}</dt>
          <dd>
            <HealthCell health={p.lastHealth} />
          </dd>
        </div>
      </dl>
      <ProviderActions provider={p} access={access} />
    </Card>
  );
}
