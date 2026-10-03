'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import {
  MARKET_APP_KINDS,
  MARKET_INSTALL_STATUSES,
  type MarketAppKind,
  type MarketInstallStatus,
  type MarketInstallation,
} from '@crm/contracts';
import { Alert, Badge, EmptyState, Select, cn } from '@crm/ui';
import { fetchInstallations, mktKeys } from '../api';
import { installationChips } from '../lib/install-state';
import { usageView, type UsageView } from '../lib/manage';
import { mktRoutes, PLANS_PATH } from '../lib/routes';
import { MarketplaceHeader } from './marketplace-header';
import {
  AppLogo,
  ChipView,
  ErrorPanel,
  LINK_BUTTON,
  LINK_BUTTON_PRIMARY,
  LINK_BUTTON_SM,
  LoadingBlock,
  PAGE,
} from './ui';

/** Everything the workspace has installed, with its state, and how much of the plan's installed-apps cap is used. */
export function InstalledPage() {
  const t = useTranslations('marketplace.installed');
  const [kind, setKind] = useState<MarketAppKind | 'all'>('all');
  const [status, setStatus] = useState<MarketInstallStatus | 'all'>('all');
  const q = useQuery({
    queryKey: mktKeys.installations(kind, status),
    queryFn: ({ signal }) =>
      fetchInstallations(
        { kind: kind === 'all' ? undefined : kind, status: status === 'all' ? undefined : status },
        signal,
      ),
  });
  const filtered = kind !== 'all' || status !== 'all';
  return (
    <div className={PAGE}>
      <MarketplaceHeader section="installed" />
      <h2 className="sr-only">{t('title')}</h2>

      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <UsagePanel usage={usageView(q.data.usage)} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="mkt-installed-kind" className="text-sm text-muted-foreground">
                {t('filters.kind')}
              </label>
              <Select
                id="mkt-installed-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as MarketAppKind | 'all')}
                className="w-auto"
              >
                <option value="all">{t('filters.all')}</option>
                {MARKET_APP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="mkt-installed-status" className="text-sm text-muted-foreground">
                {t('filters.status')}
              </label>
              <Select
                id="mkt-installed-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as MarketInstallStatus | 'all')}
                className="w-auto"
              >
                <option value="all">{t('filters.all')}</option>
                {MARKET_INSTALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {q.data.data.length === 0 ? (
            <EmptyState
              title={filtered ? t('emptyFiltered.title') : t('empty.title')}
              message={filtered ? t('emptyFiltered.message') : t('empty.message')}
              actions={
                <>
                  <Link href={mktRoutes.integrations} className={LINK_BUTTON_PRIMARY}>
                    {t('empty.integrations')}
                  </Link>
                  <Link href={mktRoutes.apps} className={LINK_BUTTON}>
                    {t('empty.apps')}
                  </Link>
                </>
              }
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" aria-label={t('listLabel')}>
              {q.data.data.map((i) => (
                <li key={i.id}>
                  <InstallationRow installation={i} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** "3 of 10 installed", the bar, a warning style near the cap and an upgrade prompt at it. Limit 0 on the wire means unlimited. */
export function UsagePanel({ usage }: { usage: UsageView }) {
  const t = useTranslations('marketplace.installed.usage');
  const pct = usage.unlimited
    ? 0
    : Math.min(100, Math.round((usage.installed / usage.limit) * 100));
  return (
    <section
      aria-labelledby="mkt-usage"
      data-testid="usage"
      data-tone={usage.tone}
      className={cn(
        'space-y-2 rounded-md border bg-background p-4',
        usage.tone === 'full' && 'border-danger/50',
        usage.tone === 'near' && 'border-warning/50',
        usage.tone === 'normal' && 'border-border',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mkt-usage" className="text-sm font-semibold">
          {usage.unlimited
            ? t('unlimited', { installed: usage.installed })
            : t('of', { installed: usage.installed, limit: usage.limit })}
        </h2>
        {usage.remaining !== null && !usage.atCap && (
          <span className="text-xs text-muted-foreground">
            {t('remaining', { count: usage.remaining })}
          </span>
        )}
      </div>
      {!usage.unlimited && (
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full',
              usage.tone === 'full'
                ? 'bg-danger'
                : usage.tone === 'near'
                  ? 'bg-warning'
                  : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {usage.atCap && (
        <Alert tone="warning">
          <p>{t('atCap')}</p>
          <p className="mt-1">
            <Link href={PLANS_PATH} className="font-medium underline">
              {t('upgrade')}
            </Link>
          </p>
        </Alert>
      )}
      {usage.nearCap && <p className="text-xs text-warning">{t('nearCap')}</p>}
    </section>
  );
}

function InstallationRow({ installation: i }: { installation: MarketInstallation }) {
  const t = useTranslations('marketplace.installed');
  const f = useFormatter();
  const chips = installationChips(i, { showUnknown: true });
  return (
    <article
      data-testid={`installation-${i.app.slug}`}
      className="flex h-full min-w-0 flex-col gap-3 rounded-md border border-border bg-background p-4"
    >
      <div className="flex items-start gap-3">
        <AppLogo name={i.app.name} logo={i.app.logo} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            <Link href={mktRoutes.manage(i.id)} className="hover:underline focus-visible:underline">
              {i.app.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {i.app.category.name} · {t('version', { version: i.version })}
          </p>
        </div>
        <Badge tone="neutral">{t(`kind.${i.app.kind}`)}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <ChipView key={c.key} chip={c} />
        ))}
      </div>
      {i.status === 'killed' && i.killReason && (
        <p className="text-sm text-danger">{t('killReason', { reason: i.killReason })}</p>
      )}
      {i.status !== 'killed' && i.health.lastError && (
        <p className="text-sm text-muted-foreground">
          {t('lastError', { error: i.health.lastError })}
        </p>
      )}
      {i.needsReconsent && i.pendingVersion && (
        <p className="text-sm text-warning">
          {t('pending', { version: i.pendingVersion.version })}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted-foreground">
          {t('installedOn', { date: f.dateTime(new Date(i.installedAt), { dateStyle: 'medium' }) })}
        </span>
        <Link href={mktRoutes.manage(i.id)} className={LINK_BUTTON_SM}>
          {i.needsReconsent ? t('review') : t('manage')}
          <span className="sr-only"> — {i.app.name}</span>
        </Link>
      </div>
    </article>
  );
}
