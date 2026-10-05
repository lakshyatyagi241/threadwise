'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import type { MarketAppDetail } from '@crm/contracts';
import { Alert, Badge, Button, EmptyState } from '@crm/ui';
import { fetchApp, mktKeys } from '../api';
import { mktError } from '../lib/errors';
import { installChips, installGate, type InstallGate } from '../lib/install-state';
import { mktRoutes } from '../lib/routes';
import { isHttpsLink, paragraphs } from '../lib/text';
import { BackLink } from './marketplace-header';
import { MaturityBadge, MaturityNotice } from './maturity';
import {
  NeedsPurchaseInstall,
  NotForSaleNote,
  PricingBlock,
  SubscribeActions,
} from './pricing-parts';
import { RiskCallout, ScopeList } from './scope-list';
import { SubscriptionPanel } from './subscription-panel';
import {
  AppLogo,
  ChipView,
  ErrorPanel,
  ExternalLink,
  LINK_BUTTON,
  LINK_BUTTON_PRIMARY,
  LoadingBlock,
  LockNotice,
  NeedsPermission,
  PAGE,
  Section,
} from './ui';
import { useMarketAccess } from './use-access';

/** The app page: what it is, what it may do, what it costs, who made it, what changed, what the admin must set up, and the install action. */
export function AppDetailPage({ slug }: { slug: string }) {
  const q = useQuery({
    queryKey: mktKeys.app(slug),
    queryFn: ({ signal }) => fetchApp(slug, signal),
  });
  const t = useTranslations('marketplace.detail');
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) {
    if (mktError(q.error).kind === 'appNotFound') {
      return (
        <div className={PAGE}>
          <BackLink href={mktRoutes.integrations} label={t('backToMarketplace')} />
          <EmptyState
            title={t('notFound.title')}
            message={t('notFound.message')}
            actions={
              <>
                <Link href={mktRoutes.integrations} className={LINK_BUTTON}>
                  {t('notFound.integrations')}
                </Link>
                <Link href={mktRoutes.apps} className={LINK_BUTTON}>
                  {t('notFound.apps')}
                </Link>
              </>
            }
          />
        </div>
      );
    }
    return (
      <div className={PAGE}>
        <BackLink href={mktRoutes.integrations} label={t('backToMarketplace')} />
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  return <AppDetail app={q.data} />;
}

export function AppDetail({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail');
  const access = useMarketAccess();
  const gate = installGate(app, { install: access.install });
  const chips = app.install ? installChips(app.install, { showUnknown: false }) : [];
  const long = paragraphs(app.listing.longDescription);
  return (
    <div className={PAGE} data-testid="app-detail">
      <BackLink
        href={mktRoutes.browse(app.kind)}
        label={app.kind === 'mini_app' ? t('backToApps') : t('backToIntegrations')}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-4">
          <AppLogo
            name={app.name}
            logo={app.logo ?? app.listing.logo}
            className="size-16 text-lg"
          />
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold">{app.name}</h1>
            <p className="text-muted-foreground">{app.tagline}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{t(`kind.${app.kind}`)}</Badge>
              <Link
                href={`${mktRoutes.browse(app.kind)}?category=${app.category.slug}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                {app.category.name}
              </Link>
              {app.firstParty && <Badge tone="neutral">{t('firstParty')}</Badge>}
              <MaturityBadge source={app} />
              {chips.map((c) => (
                <ChipView key={c.key} chip={c} />
              ))}
            </div>
          </div>
        </div>
        <InstallAction gate={gate} app={app} />
      </header>
      <MaturityNotice source={app} />

      {gate.kind === 'locked' && (
        <Alert tone="warning">
          <LockNotice lock={gate.lock} />
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <Section title={t('about')}>
            <p className="text-sm">{app.description}</p>
            {long.map((p, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {p}
              </p>
            ))}
            {app.listing.highlights.length > 0 && (
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {app.listing.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
          </Section>

          {app.listing.screenshots.length > 0 && <Screenshots app={app} />}

          <Section title={t('permissions.title')} description={t('permissions.intro')}>
            <RiskCallout scopes={app.scopes} />
            <ScopeList scopes={app.scopes} />
          </Section>

          {app.setup && <SetupNeeds setup={app.setup} />}

          <DataProcessing app={app} />

          <Changelog app={app} />
        </div>

        <aside className="min-w-0 space-y-5">
          <PricingBlock pricing={app.pricing} />
          {app.subscription && (
            <SubscriptionPanel app={app} subscription={app.subscription} canAct={access.install} />
          )}
          <Facts app={app} />
          <Support app={app} />
        </aside>
      </div>
    </div>
  );
}

function InstallAction({ gate, app }: { gate: InstallGate; app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail');
  switch (gate.kind) {
    case 'allowed':
      return (
        <Link href={gate.href} className={LINK_BUTTON_PRIMARY}>
          {t('install')}
          <span className="sr-only"> — {app.name}</span>
        </Link>
      );
    case 'subscribe':
      // A paid app with no subscription: Subscribe (and the free trial) stand where Install would; the consent step follows later.
      return gate.needsPurchase ? (
        <div className="flex min-w-0 max-w-full flex-col gap-3">
          <SubscribeActions app={app} />
          <NeedsPurchaseInstall id="mkt-install-needs-purchase" label={t('install')} />
        </div>
      ) : (
        <SubscribeActions app={app} />
      );
    case 'notForSale':
      return (
        <div className="max-w-sm">
          <NotForSaleNote />
        </div>
      );
    case 'installed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={gate.href} className={LINK_BUTTON}>
            {t('manage')}
          </Link>
        </div>
      );
    case 'killed':
      return (
        <div className="space-y-2">
          <Alert tone="danger">{t('killed')}</Alert>
          <Link href={gate.href} className={LINK_BUTTON}>
            {t('manage')}
          </Link>
        </div>
      );
    case 'locked':
      // The lock notice under the header says why and links to the upgrade; nothing here would be a dead button.
      return null;
    case 'noPermission':
      return (
        <div className="space-y-1">
          <Button disabled aria-describedby="mkt-install-needs">
            {t('install')}
          </Button>
          <div id="mkt-install-needs">
            <NeedsPermission permission={gate.permission} />
          </div>
        </div>
      );
  }
}

function Screenshots({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail');
  const shots = app.listing.screenshots.filter((s) => isHttpsLink(s.url));
  if (shots.length === 0) return null;
  return (
    <Section title={t('screenshots')}>
      <ul className="thin-scrollbar flex snap-x gap-3 overflow-x-auto pb-2">
        {shots.map((s, i) => (
          <li key={s.url} className="w-72 shrink-0 snap-start sm:w-80">
            <figure className="space-y-1">
              <img
                src={s.url}
                alt={s.caption ?? t('screenshotAlt', { name: app.name, n: i + 1 })}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-video w-full rounded-md border border-border bg-muted object-cover"
              />
              {s.caption && (
                <figcaption className="text-xs text-muted-foreground">{s.caption}</figcaption>
              )}
            </figure>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SetupNeeds({ setup }: { setup: NonNullable<MarketAppDetail['setup']> }) {
  const t = useTranslations('marketplace.detail.setup');
  return (
    <Section title={t('title')} description={t(`intro.${setup.connectorType}`)}>
      {setup.authFields.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {setup.authFields.map((f) => (
            <li key={f.key} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">
                {f.required ? t('required') : t('optional')} · {t(`kind.${f.kind}`)}
              </span>
              {f.help && <span className="basis-full text-muted-foreground">{f.help}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noFields')}</p>
      )}
      {setup.setupInstructions.length > 0 && (
        <ol className="space-y-3 text-sm">
          {setup.setupInstructions.map((s, i) => (
            <li key={i}>
              <p className="font-medium">{s.title}</p>
              {paragraphs(s.body).map((p, j) => (
                <p key={j} className="text-muted-foreground">
                  {p}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
      {setup.hasTestPayload && <p className="text-sm text-muted-foreground">{t('hasSample')}</p>}
    </Section>
  );
}

function DataProcessing({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail.data');
  const d = app.listing.dataProcessing;
  if (!d.summary && d.regions.length === 0 && !d.deletion) return null;
  return (
    <Section title={t('title')} description={t('intro')}>
      <dl className="space-y-3 text-sm">
        {d.summary && (
          <div>
            <dt className="font-medium">{t('summary')}</dt>
            <dd className="mt-0.5 text-muted-foreground">{d.summary}</dd>
          </div>
        )}
        {d.regions.length > 0 && (
          <div>
            <dt className="font-medium">{t('regions')}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {d.regions.map((r) => (
                <Badge key={r} tone="neutral">
                  {r}
                </Badge>
              ))}
            </dd>
          </div>
        )}
        {d.deletion && (
          <div>
            <dt className="font-medium">{t('deletion')}</dt>
            <dd className="mt-0.5 text-muted-foreground">{d.deletion}</dd>
          </div>
        )}
      </dl>
    </Section>
  );
}

function Changelog({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail.changelog');
  const f = useFormatter();
  const entries = app.changelog.slice(0, 5);
  if (entries.length === 0) return null;
  return (
    <Section title={t('title')}>
      <ol className="space-y-4">
        {entries.map((c) => (
          <li key={c.version} className="text-sm">
            <p className="font-medium">
              {t('version', { version: c.version })}
              {c.publishedAt && (
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  {f.dateTime(new Date(c.publishedAt), { dateStyle: 'medium' })}
                </span>
              )}
            </p>
            {paragraphs(c.notes).map((p, i) => (
              <p key={i} className="text-muted-foreground">
                {p}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Facts({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail.facts');
  return (
    <Section title={t('title')}>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t('version')}</dt>
          <dd className="font-medium">{app.version}</dd>
        </div>
        {app.connectorType && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('connector')}</dt>
            <dd className="font-medium">{t(`connectors.${app.connectorType}`)}</dd>
          </div>
        )}
        {app.installCount > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('installs')}</dt>
            <dd className="font-medium">{app.installCount}</dd>
          </div>
        )}
        {app.developer && (
          <div>
            <dt className="text-xs text-muted-foreground">{t('developer')}</dt>
            <dd className="font-medium">
              {app.developer.url ? (
                <ExternalLink href={app.developer.url}>{app.developer.name}</ExternalLink>
              ) : (
                app.developer.name
              )}
            </dd>
          </div>
        )}
      </dl>
    </Section>
  );
}

function Support({ app }: { app: MarketAppDetail }) {
  const t = useTranslations('marketplace.detail.support');
  const s = app.support;
  const links = (['website', 'docs', 'privacy', 'terms', 'status'] as const).flatMap((k) =>
    s[k] ? [{ key: k, href: s[k] }] : [],
  );
  if (links.length === 0 && !s.email) return null;
  return (
    <Section title={t('title')}>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.key}>
            <ExternalLink href={l.href}>{t(l.key)}</ExternalLink>
          </li>
        ))}
        {s.email && (
          <li>
            <a
              href={`mailto:${s.email}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('email')}
            </a>
            <span className="ms-2 text-muted-foreground">{s.email}</span>
          </li>
        )}
      </ul>
    </Section>
  );
}
