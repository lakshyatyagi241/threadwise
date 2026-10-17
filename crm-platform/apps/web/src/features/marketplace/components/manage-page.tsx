'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import type { MarketAppDetail, MarketDataChoice, MarketInstallation } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, EmptyState, Spinner, useToast } from '@crm/ui';
import {
  acceptNewPermissions,
  fetchApp,
  fetchInstallation,
  mktKeys,
  setInstallationEnabled,
  uninstallApp,
} from '../api';
import { acceptedScopesFor } from '../lib/consent';
import { mktError } from '../lib/errors';
import { installationChips } from '../lib/install-state';
import { manageView, uninstallBody } from '../lib/manage';
import { uninstallRenewal } from '../lib/pricing';
import { appHomeFor } from '../lib/app-home';
import { mktRoutes } from '../lib/routes';
import type { SetupField } from '../lib/setup-form';
import { CredentialsPanel } from './manage-credentials';
import { ConnectionPanel, EventsPanel } from './manage-connection';
import { ProblemNotice } from './manage-parts';
import { BackLink } from './marketplace-header';
import { ScopeList } from './scope-list';
import { SubscriptionEndedBanner, SubscriptionSectionView } from './subscription-panel';
import { UninstallDialog } from './uninstall-dialog';
import {
  AppLogo,
  ChipView,
  ErrorPanel,
  LINK_BUTTON,
  LINK_BUTTON_PRIMARY,
  LoadingBlock,
  NeedsPermission,
  PAGE,
  Section,
} from './ui';
import { useAsyncAction } from './use-async-action';
import { useMarketAccess } from './use-access';

/** What the form edits: the listing's setup fields when they could be read, else the credentials the installation reports. */
function fieldsFor(
  installation: MarketInstallation,
  app: MarketAppDetail | undefined,
): SetupField[] {
  if (app?.setup) return app.setup.authFields;
  return installation.credentials.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    required: false,
    help: null,
    placeholder: null,
    options: null,
  }));
}

/** The manage page of one installation. */
export function ManagePage({ id }: { id: string }) {
  const t = useTranslations('marketplace.manage');
  const inst = useQuery({
    queryKey: mktKeys.installation(id),
    queryFn: ({ signal }) => fetchInstallation(id, signal),
  });
  const slug = inst.data?.app.slug;
  const app = useQuery({
    queryKey: mktKeys.app(slug ?? ''),
    queryFn: ({ signal }) => fetchApp(slug as string, signal),
    enabled: Boolean(slug),
  });
  if (inst.isPending) return <LoadingBlock />;
  if (inst.isError) {
    const kind = mktError(inst.error).kind;
    return (
      <div className={PAGE}>
        <BackLink href={mktRoutes.installed} label={t('backToInstalled')} />
        {kind === 'notInstalled' || kind === 'notFound' ? (
          <EmptyState
            title={t('notFound.title')}
            message={t('notFound.message')}
            actions={
              <Link href={mktRoutes.installed} className={LINK_BUTTON}>
                {t('backToInstalled')}
              </Link>
            }
          />
        ) : (
          <ErrorPanel error={inst.error} onRetry={() => void inst.refetch()} />
        )}
      </div>
    );
  }
  return (
    <ManageScreen installation={inst.data} app={app.data} reload={() => void inst.refetch()} />
  );
}

export function ManageScreen({
  installation,
  app,
  reload,
}: {
  installation: MarketInstallation;
  app: MarketAppDetail | undefined;
  reload: () => void;
}) {
  const t = useTranslations('marketplace.manage');
  const td = useTranslations('marketplace.detail');
  const f = useFormatter();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const access = useMarketAccess();
  const view = manageView(installation, access, {
    hasTestPayload: app?.setup?.hasTestPayload ?? false,
  });
  const chips = installationChips(installation, { showUnknown: true });
  const open = appHomeFor(installation.app.slug, installation.status);
  const fields = fieldsFor(installation, app);

  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const toggle = useAsyncAction();
  const consent = useAsyncAction();
  const uninstall = useAsyncAction();

  /** An installation answer (it never holds a secret) replaces the cached one; lists and the app card are refreshed. */
  const setInstallation = (next: MarketInstallation) => {
    qc.setQueryData(mktKeys.installation(installation.id), next);
    void qc.invalidateQueries({ queryKey: mktKeys.installationsAll });
    void qc.invalidateQueries({ queryKey: mktKeys.appsAll });
  };

  const setEnabled = async (enabled: boolean) => {
    const out = await toggle.run(() =>
      setInstallationEnabled(installation.id, enabled, installation.rowVersion),
    );
    setConfirmPause(false);
    if (!out.ok) return;
    setInstallation(out.value);
    // Pausing or resuming an app turns its screens off or on: the menu and the app gate are read on the server, so they are read again.
    router.refresh();
    toast(enabled ? t('toast.resumed') : t('toast.paused'));
  };

  const acceptPermissions = async () => {
    if (!installation.pendingVersion) return;
    const out = await consent.run(() =>
      acceptNewPermissions(installation.id, {
        acceptedScopes: acceptedScopesFor(installation.pendingVersion!.scopes),
      }),
    );
    if (!out.ok) return;
    setInstallation(out.value);
    toast(t('toast.consented', { version: out.value.version }));
  };

  const doUninstall = async (choice: MarketDataChoice) => {
    const out = await uninstall.run(() => uninstallApp(installation.id, uninstallBody(choice)));
    if (!out.ok) return;
    qc.removeQueries({ queryKey: mktKeys.installation(installation.id) });
    qc.removeQueries({ queryKey: mktKeys.events(installation.id) });
    void qc.invalidateQueries({ queryKey: mktKeys.installationsAll });
    void qc.invalidateQueries({ queryKey: mktKeys.appsAll });
    void qc.invalidateQueries({ queryKey: mktKeys.app(installation.app.slug) });
    toast(t('toast.uninstalled', { name: installation.app.name }));
    router.push(mktRoutes.installed);
    router.refresh();
  };

  const checked = installation.health.checkedAt
    ? f.dateTime(new Date(installation.health.checkedAt), {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div className={PAGE} data-testid="manage-page">
      <BackLink href={mktRoutes.installed} label={t('backToInstalled')} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-4">
          <AppLogo
            name={installation.app.name}
            logo={installation.app.logo}
            className="size-16 text-lg"
          />
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold">{installation.app.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t('version', { version: installation.version })} · {installation.app.category.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <ChipView key={c.key} chip={c} />
              ))}
            </div>
            {!view.killed && (
              <p className="text-xs text-muted-foreground">
                {checked ? t('checkedAt', { date: checked }) : t('notChecked')}
              </p>
            )}
            {!view.killed && installation.health.lastError && (
              <p className="text-sm text-danger" data-testid="health-error">
                {t('lastError', { error: installation.health.lastError })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open && (
            <Link href={open} className={LINK_BUTTON_PRIMARY} data-testid="manage-open">
              {td('open')}
              <span className="sr-only"> — {installation.app.name}</span>
            </Link>
          )}
          <Link href={mktRoutes.app(installation.app.slug)} className={LINK_BUTTON}>
            {t('viewListing')}
          </Link>
          {view.canToggle &&
            (view.paused ? (
              <Button onClick={() => void setEnabled(true)} disabled={toggle.pending}>
                {toggle.pending && <Spinner />}
                {t('resume')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirmPause(true)}
                disabled={toggle.pending}
              >
                {t('pause')}
              </Button>
            ))}
        </div>
      </header>
      {toggle.error ? <ProblemNotice error={toggle.error} onReload={reload} /> : null}
      {!view.killed && view.missing.manage && <NeedsPermission permission="market.apps.manage" />}

      {view.killed && (
        <Alert tone="danger" data-testid="killed-banner">
          <p className="font-medium">{t('killed.title')}</p>
          <p>{t('killed.message')}</p>
          {installation.killReason && (
            <p className="mt-1">{t('killed.reason', { reason: installation.killReason })}</p>
          )}
        </Alert>
      )}
      {view.subscriptionPause && (
        <SubscriptionEndedBanner
          app={{ slug: installation.app.slug, name: installation.app.name }}
          pause={view.subscriptionPause}
          canResubscribe={view.canResubscribe}
          canResume={view.canToggle}
          onResume={() => void setEnabled(true)}
          resuming={toggle.pending}
        />
      )}
      {view.paused && !view.subscriptionPause && (
        <Alert tone="warning" data-testid="paused-banner">
          <p className="font-medium">{t('paused.title')}</p>
          <p>{t('paused.message')}</p>
        </Alert>
      )}
      {view.needsConsent && installation.pendingVersion && (
        <PendingConsent
          installation={installation}
          canAccept={view.canAcceptConsent}
          pending={consent.pending}
          error={consent.error}
          onAccept={() => void acceptPermissions()}
          onReload={reload}
        />
      )}

      {view.subscriptionSection && (
        <SubscriptionSectionView
          section={view.subscriptionSection}
          app={{ slug: installation.app.slug, name: installation.app.name }}
          subscription={installation.subscription}
          pricing={installation.pricing}
          canAct={access.install}
        />
      )}

      {!view.onlyUninstall && (
        <>
          <Section title={t('permissions.title')} description={t('permissions.intro')}>
            <ScopeList scopes={installation.grantedScopes} />
          </Section>

          {fields.length > 0 && (
            <CredentialsPanel
              key={installation.rowVersion}
              installation={installation}
              fields={fields}
              canConfigure={view.canConfigure}
              onSaved={setInstallation}
              onReload={reload}
            />
          )}

          {installation.connection && (
            <ConnectionPanel
              installation={installation}
              view={view}
              onRotated={setInstallation}
              onTested={reload}
              onReload={reload}
            />
          )}
          {installation.connection && <EventsPanel installationId={installation.id} />}
        </>
      )}

      <Section
        title={t('uninstall.section')}
        description={t('uninstall.sectionIntro')}
        tone="danger"
      >
        {view.canUninstall ? (
          <div>
            <Button variant="danger" onClick={() => setConfirmUninstall(true)}>
              {t('uninstall.open')}
            </Button>
          </div>
        ) : (
          <NeedsPermission permission="market.apps.install" />
        )}
      </Section>

      {view.canToggle && !view.paused && (
        <ConfirmDialog
          open={confirmPause}
          title={t('pauseConfirm.title', { name: installation.app.name })}
          message={t('pauseConfirm.message')}
          confirmLabel={t('pauseConfirm.confirm')}
          cancelLabel={t('pauseConfirm.cancel')}
          busy={toggle.pending}
          onConfirm={() => void setEnabled(false)}
          onClose={() => setConfirmPause(false)}
        />
      )}
      {view.canUninstall && (
        <UninstallDialog
          open={confirmUninstall}
          name={installation.app.name}
          hasConnection={installation.connection !== null}
          renewal={uninstallRenewal(installation.subscription)}
          busy={uninstall.pending}
          error={uninstall.error}
          onConfirm={(choice) => void doUninstall(choice)}
          onClose={() => setConfirmUninstall(false)}
        />
      )}
    </div>
  );
}

/** A newer version asks for more permissions than were granted. The installation runs on its old version until they are accepted. */
function PendingConsent({
  installation,
  canAccept,
  pending,
  error,
  onAccept,
  onReload,
}: {
  installation: MarketInstallation;
  canAccept: boolean;
  pending: boolean;
  error: unknown;
  onAccept: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('marketplace.manage.reconsent');
  const p = installation.pendingVersion!;
  return (
    <Section
      title={t('title', { version: p.version })}
      description={t('message', { current: installation.version, version: p.version })}
      tone="danger"
      id="reconsent"
    >
      <div data-testid="reconsent-banner" className="space-y-3">
        <div>
          <h3 className="mb-1.5 text-sm font-medium">{t('newScopes')}</h3>
          <ScopeList scopes={p.newScopes} added={new Set(p.newScopes.map((s) => s.id))} />
        </div>
        <div>
          <h3 className="mb-1.5 text-sm font-medium">{t('fullList')}</h3>
          <ScopeList scopes={p.scopes} added={new Set(p.newScopes.map((s) => s.id))} />
        </div>
        {error ? <ProblemNotice error={error} onReload={onReload} /> : null}
        {canAccept ? (
          <Button onClick={onAccept} disabled={pending}>
            {pending && <Spinner />}
            {t('accept')}
          </Button>
        ) : (
          <NeedsPermission permission="market.apps.install" />
        )}
      </div>
    </Section>
  );
}
