'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { MarketOperatorAppDetail } from '@crm/contracts';
import { Alert, Badge, Button, StatTile, Tabs } from '@crm/ui';
import { ConferencingSetupPanel } from '@/features/meeting-conferencing/components/operator-setup-panel';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { fetchApp, marketKeys } from '../api';
import { lackedPermissions } from '../lib/lifecycle';
import { CATALOGUE_PATH } from '../lib/paths';
import { MARKET_PERMISSIONS, type MarketAccess } from '../lib/permissions';
import { AppActions, type Notice } from './app-actions';
import { ListingEdit } from './listing-edit';
import { PricingPanel } from './pricing-panel';
import {
  AppStatusBadge,
  ConnectorLabel,
  Failure,
  KindLabel,
  LoadingBlock,
  MarketGate,
  Section,
} from './ui';
import { VersionsPanel } from './versions-panel';

const NS = 'marketplace.operator.detail';

export type TabId = 'overview' | 'versions';

/** Operator console: one listing, its versions and the actions each state allows. Needs `platform.market.manage` or `platform.market.review`. */
export function ListingDetailPage({
  appRef,
  initialTab = 'overview',
}: {
  appRef: string;
  /** The tab that opens first (the page itself always opens on the listing; a link or a test may ask for the versions). */
  initialTab?: TabId;
}) {
  return (
    <MarketGate>
      {(access) => <Detail appRef={appRef} access={access} initialTab={initialTab} />}
    </MarketGate>
  );
}

function Detail({
  appRef,
  access,
  initialTab,
}: {
  appRef: string;
  access: MarketAccess;
  initialTab: TabId;
}) {
  const t = useTranslations(NS);
  const [versionId, setVersionId] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [notice, setNotice] = useState<Notice | null>(null);
  const q = useQuery({
    queryKey: marketKeys.app(appRef, versionId),
    queryFn: ({ signal }) => fetchApp(appRef, versionId, signal),
    // Switching version keeps the page on screen while the other version's documents load.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const back = (
    <Link
      href={CATALOGUE_PATH}
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
  if (q.isError && !q.data) {
    return (
      <div className="space-y-4">
        {back}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const app = q.data!;

  return (
    <div className="space-y-6">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {app.name}
            <AppStatusBadge status={app.status} />
            {app.firstParty && <Badge tone="success">{t('firstParty')}</Badge>}
            {app.featured && <Badge tone="warning">{t('featured')}</Badge>}
          </span>
        }
        description={
          <span className="space-y-1">
            <span className="block font-mono text-xs" dir="ltr">
              {app.slug}
            </span>
            <span className="block" dir="auto">
              {app.tagline}
            </span>
          </span>
        }
      />

      {q.isError && <Failure error={q.error} onRetry={() => void q.refetch()} />}
      {notice && <NoticeAlert notice={notice} onDismiss={() => setNotice(null)} />}
      {app.status === 'killed' && <KilledAlert app={app} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('kpi.installs')} value={app.installCount} />
        <StatTile
          label={t('kpi.published')}
          value={app.publishedVersion ?? t('none')}
          tone="accent"
        />
        <StatTile label={t('kpi.latest')} value={app.latestVersion ?? t('none')} />
        <StatTile label={t('kpi.versions')} value={app.versions.length} />
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Fact label={t('facts.kind')}>
          <KindLabel kind={app.kind} />
        </Fact>
        <Fact label={t('facts.category')}>{app.category.name}</Fact>
        <Fact label={t('facts.connector')}>
          {app.connectorType ? (
            <>
              <ConnectorLabel type={app.connectorType} />{' '}
              <code className="font-mono text-xs text-muted-foreground" dir="ltr">
                ({app.connectorType})
              </code>
            </>
          ) : (
            t('none')
          )}
        </Fact>
        <Fact label={t('facts.planFeature')}>
          {app.planFeature ? (
            <code className="font-mono text-xs" dir="ltr">
              {app.planFeature}
            </code>
          ) : (
            t('everyPlan')
          )}
        </Fact>
      </dl>

      <Operate app={app} access={access} onNotice={setNotice} />

      {/* Zoom and Microsoft Teams only: what the platform still needs before a workspace can use the listing (read-only). */}
      <ConferencingSetupPanel slug={app.slug} />

      <PricingPanel app={app} access={access} />

      <Tabs
        value={tab}
        onValueChange={(id) => setTab(id as TabId)}
        items={[
          {
            id: 'overview',
            label: t('tabs.overview'),
            content: <ListingEdit detail={app} access={access} />,
          },
          {
            id: 'versions',
            label: t('tabs.versions', { count: app.versions.length }),
            content: (
              <VersionsPanel
                detail={app}
                access={access}
                onSelect={(id) => setVersionId(id)}
                onNotice={setNotice}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The listing-level actions, and one line naming the key that would unlock what the caller does not see. */
function Operate({
  app,
  access,
  onNotice,
}: {
  app: MarketOperatorAppDetail;
  access: MarketAccess;
  onNotice: (n: Notice) => void;
}) {
  const t = useTranslations(NS);
  const version = app.versions.find((v) => v.id === app.versionId) ?? null;
  const lacking = lackedPermissions(app, version, access);
  return (
    <Section id="operate" title={t('operate.title')} description={t('operate.description')}>
      <AppActions app={app} access={access} onNotice={onNotice} />
      {lacking.map((name) => (
        <p key={name} className="text-xs text-muted-foreground" data-testid={`lacks-${name}`}>
          {t('operate.lacking', { permission: MARKET_PERMISSIONS[name] })}
        </p>
      ))}
    </Section>
  );
}

function KilledAlert({ app }: { app: MarketOperatorAppDetail }) {
  const t = useTranslations(NS);
  const format = useFormatter();
  return (
    <Alert tone="danger" className="space-y-1">
      <p className="font-medium">{t('killed.title')}</p>
      {app.killReason && (
        <p dir="auto">
          {t('killed.reason')}: {app.killReason}
        </p>
      )}
      {app.killedAt && (
        <p className="text-xs opacity-80">
          <time dateTime={app.killedAt}>
            {format.dateTime(new Date(app.killedAt), { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        </p>
      )}
      <p className="text-xs">{t('killed.effect')}</p>
    </Alert>
  );
}

function NoticeAlert({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const t = useTranslations(`${NS}.notice`);
  return (
    <Alert
      tone="success"
      className="flex flex-wrap items-start justify-between gap-3"
      data-testid="notice"
    >
      <div className="space-y-1">
        {notice.kind === 'killed' ? (
          <>
            <p className="font-medium">{t('killedTitle', { name: notice.name })}</p>
            <p>{t('killedBody', { count: notice.disabledInstallations })}</p>
          </>
        ) : (
          <>
            <p className="font-medium">
              {t('publishedTitle', { name: notice.name, version: notice.version })}
            </p>
            <p>{t('publishedUpgraded', { count: notice.upgraded })}</p>
            <p>{t('publishedWaiting', { count: notice.awaitingConsent })}</p>
          </>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={onDismiss}>
        {t('dismiss')}
      </Button>
    </Alert>
  );
}
