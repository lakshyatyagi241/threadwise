'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { WhatsappProvider } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { CopyButton } from '@/features/auth-registration-security/platform/ui/copy-button';
import { fetchProvider, wapKeys } from '../api';
import { readinessGaps } from '../lib/draft';
import { CONSOLE_WHATSAPP_SETTINGS_PATH } from '../lib/provider-view';
import type { WapAccess } from '../lib/permissions';
import { ProviderActionButtons, SwitchLink } from './provider-actions';
import { PROVIDERS_PATH, ProviderForm } from './provider-form';
import { TestPanel } from './test-panel';
import {
  BuiltinBadge,
  DefaultBadge,
  Failure,
  LoadingBlock,
  SecretState,
  Section,
  StatusBadge,
  WapGate,
} from './ui';

const NS = 'whatsapp-providers.detail';

/** One provider: what it is, what it still lacks, the lifecycle actions, the live test and the edit form. */
export function ProviderDetailPage({ id }: { id: string }) {
  return <WapGate need={['view']}>{(access) => <Detail id={id} access={access} />}</WapGate>;
}

function Detail({ id, access }: { id: string; access: WapAccess }) {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: wapKeys.one(id),
    queryFn: ({ signal }) => fetchProvider(id, signal),
    refetchOnWindowFocus: false,
  });

  const back = (
    <Link
      href={PROVIDERS_PATH}
      className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
    >
      {t('back')}
    </Link>
  );

  if (q.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-4">
        {back}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const p = q.data;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.label}
            <StatusBadge status={p.status} />
            {p.isDefault && <DefaultBadge />}
            {p.builtin && <BuiltinBadge />}
          </span>
        }
        description={<span className="font-mono text-xs">{p.key}</span>}
        actions={<SwitchLink provider={p} access={access} />}
      />

      <Gaps provider={p} />

      {access.manage && (
        <Section
          id="lifecycle"
          title={t('lifecycle.title')}
          description={t('lifecycle.description')}
        >
          <ProviderActionButtons provider={p} access={access} layout="buttons" />
        </Section>
      )}

      <Overview provider={p} />

      <TestPanel provider={p} canTest={access.manage && p.status !== 'archived'} />

      {access.manage ? (
        <section aria-labelledby="edit-title" className="space-y-3">
          <h2 id="edit-title" className="text-lg font-semibold">
            {t('edit.title')}
          </h2>
          <ProviderForm key={`${p.id}:${p.rowVersion}`} mode="edit" provider={p} />
        </section>
      ) : (
        <Alert>{t('edit.readOnly')}</Alert>
      )}
    </div>
  );
}

function Gaps({ provider: p }: { provider: WhatsappProvider }) {
  const t = useTranslations(NS);
  const tg = useTranslations('whatsapp-providers.gaps');
  const gaps = readinessGaps(p);
  if (gaps.length === 0) return null;
  return (
    <Alert tone="warning" className="space-y-1">
      <p className="font-medium">{t('gapsTitle')}</p>
      <ul className="list-disc ps-5">
        {gaps.map((g) => (
          <li key={g}>{tg(g)}</li>
        ))}
      </ul>
    </Alert>
  );
}

function Overview({ provider: p }: { provider: WhatsappProvider }) {
  const t = useTranslations(`${NS}.overview`);
  const tf = useTranslations('whatsapp-providers.form.fields');
  const te = useTranslations('whatsapp-providers.enums');
  const format = useFormatter();
  const rows: Array<[string, ReactNode]> = [
    [
      tf('baseUrl'),
      <code key="u" dir="ltr" className="break-all text-xs">
        {p.baseUrl}
        {p.apiVersion ? `/${p.apiVersion}` : ''}
      </code>,
    ],
    [tf('authScheme'), te(`authScheme.${p.authScheme}.label`)],
    ...(p.authScheme === 'custom_headers'
      ? ([
          [
            t('headers'),
            <span key="h" dir="ltr" className="font-mono text-xs">
              {Object.keys(p.headerTemplates).join(', ') || t('none')}
            </span>,
          ],
        ] as Array<[string, ReactNode]>)
      : []),
    [tf('credentialMode'), te(`credentialMode.${p.credentialMode}.label`)],
    [tf('webhookMode'), te(`webhookMode.${p.webhookMode}.label`)],
    [
      tf('signatureScheme'),
      <span key="s">
        {te(`signatureScheme.${p.signatureScheme}.label`)}
        {p.signatureHeaderName && (
          <code dir="ltr" className="ms-2 text-xs">
            {p.signatureHeaderName}
          </code>
        )}
      </span>,
    ],
    [
      tf('billingMode'),
      <span key="b">
        {te(`billingMode.${p.billingMode}.label`)}
        {p.engineBillingMode && (
          <span className="ms-2 text-xs text-muted-foreground">
            {t('engineMode', { mode: p.engineBillingMode })}
          </span>
        )}
      </span>,
    ],
    [tf('mediaUpload'), p.capabilities.mediaUpload ? t('yes') : t('no')],
    [tf('onboarding'), te(`onboarding.${p.onboarding}.label`)],
    [
      t('usage'),
      `${t('numbers', { count: p.numberCount })} · ${t('workspaces', { count: p.workspaceCount })}`,
    ],
    [
      t('updated'),
      <time key="t" dateTime={p.updatedAt}>
        {format.dateTime(new Date(p.updatedAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </time>,
    ],
  ];
  const secrets = ['providerToken', 'appSecret', 'webhookSecret', 'verifyToken'] as const;

  return (
    <Section id="overview" title={t('title')}>
      {p.builtin && (
        <Alert>
          <p>{t('builtinNote')}</p>
          <Link
            href={CONSOLE_WHATSAPP_SETTINGS_PATH}
            className="mt-1 inline-block text-sm font-medium underline"
          >
            {t('openConsoleSettings')}
          </Link>
        </Alert>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {!p.builtin && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('credentialsTitle')}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {secrets.map((k) => (
              <li
                key={k}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{tf(k)}</span>
                <SecretState state={p.credentials[k]} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('credentialsNote')}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{t('webhookTitle')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <code dir="ltr" className="rounded-md border border-border bg-muted px-2 py-1 text-xs">
            {p.webhookPath}
          </code>
          <CopyButton text={p.webhookPath} />
        </div>
        <p className="text-xs text-muted-foreground">{t('webhookNote')}</p>
      </div>
    </Section>
  );
}
