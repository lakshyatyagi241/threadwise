'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MarketAppDetail, MarketScopeSummary } from '@crm/contracts';
import { Alert, Button, Checkbox, EmptyState, Spinner, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { fetchApp, installApp, mktKeys } from '../api';
import { acceptedScopesFor, installerGaps, scopeChanges, type ScopeChanges } from '../lib/consent';
import { mktError, type MktError } from '../lib/errors';
import { installGate } from '../lib/install-state';
import { mktRoutes } from '../lib/routes';
import { startReveal, type RevealState } from '../lib/secret-reveal';
import {
  buildInstallCredentials,
  initialValues,
  validateFields,
  type FieldProblem,
  type FieldValues,
  type SetupField,
} from '../lib/setup-form';
import { paragraphs } from '../lib/text';
import { BackLink } from './marketplace-header';
import { RiskCallout, ScopeList } from './scope-list';
import { SecretReveal } from './secret-reveal';
import { SetupFields } from './setup-fields';
import {
  AppLogo,
  ErrorLine,
  ErrorPanel,
  LINK_BUTTON,
  LINK_BUTTON_PRIMARY,
  LoadingBlock,
  LockNotice,
  NeedsPermission,
  PAGE,
  Section,
  TEXT_LINK,
} from './ui';
import { useAsyncAction } from './use-async-action';
import { useMarketAccess } from './use-access';

type Step = 'permissions' | 'setup' | 'done';

const without = <V,>(record: Record<string, V>, key: string): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

interface Done {
  installationId: string;
  version: string;
}

/**
 * The install flow of one app: (1) permissions and consent, (2) setup (the form generated from the listing), (3) done, with the
 * one-time secret. `acceptedScopes` is always exactly the list that was on screen; if the app changed it meanwhile the API answers
 * 422 MKT_CONSENT_REQUIRED and the person is taken back to step 1 with the difference marked.
 */
export function InstallPage({ slug }: { slug: string }) {
  const t = useTranslations('marketplace.install');
  const q = useQuery({
    queryKey: mktKeys.app(slug),
    queryFn: ({ signal }) => fetchApp(slug, signal),
  });
  const backHref = mktRoutes.app(slug);
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) {
    const e = mktError(q.error);
    return (
      <div className={PAGE}>
        <BackLink href={mktRoutes.integrations} label={t('backToMarketplace')} />
        {e.kind === 'appNotFound' ? (
          <EmptyState title={t('notFound.title')} message={t('notFound.message')} />
        ) : (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <BackLink href={backHref} label={t('backToApp', { name: q.data.name })} />
      <InstallFlow app={q.data} refetch={() => q.refetch().then((r) => r.data)} />
    </div>
  );
}

export function InstallFlow({
  app,
  refetch,
}: {
  app: MarketAppDetail;
  /** Reloads the app page and answers it (used after the permission list changed under the person). */
  refetch?: () => Promise<MarketAppDetail | undefined>;
}) {
  const t = useTranslations('marketplace.install');
  const access = useMarketAccess();
  const session = useSession();
  const qc = useQueryClient();
  const action = useAsyncAction();

  const fields: SetupField[] = app.setup?.authFields ?? [];
  const needsSetup = fields.length > 0;

  // What the person was shown. A snapshot: the list the API checks consent against is the one they confirmed.
  const [shown, setShown] = useState<MarketScopeSummary[]>(app.scopes);
  const [confirmed, setConfirmed] = useState(false);
  const [changes, setChanges] = useState<{
    diff: ScopeChanges;
    removed: MarketScopeSummary[];
  } | null>(null);
  const [step, setStep] = useState<Step>('permissions');
  const [values, setValues] = useState<FieldValues>(() => initialValues(fields));
  const [problems, setProblems] = useState<Record<string, FieldProblem>>({});
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<RevealState>({ phase: 'none' });
  const [done, setDone] = useState<Done | null>(null);
  const [failed, setFailed] = useState<{ view: MktError; error: unknown } | null>(null);
  const [alreadyId, setAlreadyId] = useState<string | null>(null);

  const gate = installGate(app, { install: access.install });

  if (done) {
    return <DoneStep app={app} done={done} reveal={reveal} onReveal={setReveal} />;
  }

  if (gate.kind === 'installed' || gate.kind === 'killed') {
    return (
      <Section title={t('alreadyTitle')}>
        <p className="text-sm text-muted-foreground">{t('alreadyMessage', { name: app.name })}</p>
        <Link href={gate.href} className={LINK_BUTTON}>
          {t('openManage')}
        </Link>
      </Section>
    );
  }
  if (gate.kind === 'locked') {
    return (
      <Section title={t('lockedTitle', { name: app.name })}>
        <LockNotice lock={gate.lock} />
      </Section>
    );
  }
  if (gate.kind === 'noPermission') {
    return (
      <Section title={t('noPermissionTitle')}>
        <p className="text-sm text-muted-foreground">{t('noPermissionMessage')}</p>
        <NeedsPermission permission={gate.permission} />
      </Section>
    );
  }

  const gaps = installerGaps(
    shown.map((s) => s.id),
    session.permissions,
  );
  const steps: Step[] = needsSetup ? ['permissions', 'setup', 'done'] : ['permissions', 'done'];

  const submit = async () => {
    setFailed(null);
    setServerFields({});
    if (needsSetup) {
      const found = validateFields(fields, values, { mode: 'install' });
      setProblems(found);
      if (Object.keys(found).length > 0) return;
    }
    const outcome = await action.run(() =>
      installApp(app.slug, {
        acceptedScopes: acceptedScopesFor(shown),
        credentials: buildInstallCredentials(fields, values),
        config: {},
      }),
    );
    if (!outcome.ok) {
      await onFailure(outcome.error);
      return;
    }
    const result = outcome.value;
    // Everything the form held (credentials included) is dropped; the secret goes into the reveal state only.
    setValues({});
    const inbound = result.installation.connection?.inbound ?? null;
    setReveal(
      startReveal(
        result.inboundSecret
          ? {
              secret: result.inboundSecret,
              url: inbound?.url ?? null,
              tokenHeader: inbound?.tokenHeader ?? null,
              signatureHeader: inbound?.signatureHeader ?? null,
              auth: inbound?.auth ?? null,
            }
          : null,
      ),
    );
    setDone({ installationId: result.installation.id, version: result.installation.version });
    void qc.invalidateQueries({ queryKey: mktKeys.installationsAll });
    void qc.invalidateQueries({ queryKey: mktKeys.appsAll });
    void qc.invalidateQueries({ queryKey: mktKeys.app(app.slug) });
    void qc.invalidateQueries({ queryKey: ['marketplace', 'shelves'] });
  };

  // The call failed, so nothing was installed: decide what the person sees and where they go next.
  const onFailure = async (error: unknown) => {
    const view = mktError(error);
    setFailed({ view, error });
    if (view.kind === 'consentRequired' || view.kind === 'reconsentRequired') {
      // The list changed while they were reading it: reload it, mark the difference and ask again from step 1.
      const fresh = (await refetch?.()) ?? null;
      const next = fresh?.scopes ?? shown;
      const diff = scopeChanges(shown, next);
      setChanges({ diff, removed: shown.filter((s) => diff.removedIds.includes(s.id)) });
      setShown(next);
      setConfirmed(false);
      setStep('permissions');
    } else if (view.kind === 'alreadyInstalled') {
      const fresh = (await refetch?.()) ?? null;
      setAlreadyId(fresh?.install?.installationId ?? null);
    } else if (Object.keys(view.fields).length > 0) {
      setServerFields(view.fields);
      setStep('setup');
    }
  };

  const onContinue = () => {
    if (needsSetup) setStep('setup');
    else void submit();
  };

  return (
    <div className="space-y-5" data-testid="install-flow">
      <header className="flex items-start gap-3">
        <AppLogo name={app.name} logo={app.logo ?? app.listing.logo} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t('title', { name: app.name })}</h1>
          <p className="text-sm text-muted-foreground">{app.tagline}</p>
        </div>
      </header>

      <ol aria-label={t('stepsLabel')} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              s === step ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                s === step ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
              )}
            >
              {i + 1}
            </span>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {step === 'permissions' && (
        <Section
          title={t('permissions.title')}
          description={t('permissions.intro', { name: app.name })}
        >
          {changes && <ChangedNotice changes={changes} />}
          {failed?.view.kind === 'consentRequired' && failed.view.consent && (
            <p className="sr-only">
              {t('permissions.diffSummary', {
                missing: failed.view.consent.missing.length,
                unexpected: failed.view.consent.unexpected.length,
              })}
            </p>
          )}
          <RiskCallout scopes={shown} />
          <ScopeList scopes={shown} added={new Set(changes?.diff.added.map((s) => s.id) ?? [])} />
          {gaps.length > 0 && <GapsNotice keys={gaps} />}
          <Checkbox
            id="mkt-consent"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            label={
              shown.length === 0
                ? t('permissions.consentNone', { name: app.name })
                : t('permissions.consent', { name: app.name })
            }
          />
          {failed &&
            failed.view.kind !== 'consentRequired' &&
            failed.view.kind !== 'reconsentRequired' && (
              <FailureView failed={failed.view} error={failed.error} alreadyId={alreadyId} />
            )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={mktRoutes.app(app.slug)} className={LINK_BUTTON}>
              {t('cancel')}
            </Link>
            <Button onClick={onContinue} disabled={!confirmed || action.pending}>
              {action.pending && <Spinner />}
              {needsSetup ? t('permissions.continue') : t('install')}
            </Button>
          </div>
        </Section>
      )}

      {step === 'setup' && (
        <Section title={t('setup.title')} description={t('setup.intro')}>
          {app.setup && app.setup.setupInstructions.length > 0 && (
            <ol className="space-y-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
              {app.setup.setupInstructions.map((s, i) => (
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
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <SetupFields
              fields={fields}
              values={values}
              onChange={(k, v) => {
                setValues((cur) => ({ ...cur, [k]: v }));
                setProblems((cur) => without(cur, k));
                setServerFields((cur) => without(cur, k));
              }}
              problems={problems}
              serverFields={serverFields}
              mode="install"
              idPrefix="mkt-setup"
              disabled={action.pending}
            />
            {failed && (
              <FailureView failed={failed.view} error={failed.error} alreadyId={alreadyId} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="secondary"
                onClick={() => setStep('permissions')}
                disabled={action.pending}
              >
                {t('back')}
              </Button>
              <Button type="submit" disabled={action.pending}>
                {action.pending && <Spinner />}
                {t('install')}
              </Button>
            </div>
          </form>
        </Section>
      )}
      <p aria-live="polite" className="sr-only">
        {action.pending ? t('installing') : ''}
      </p>
    </div>
  );
}

/** What went wrong in the install call, in words, with the way forward (upgrade, open the existing install, missing permissions). */
export function FailureView({
  failed,
  error,
  alreadyId,
}: {
  failed: MktError;
  error: unknown;
  alreadyId: string | null;
}) {
  const t = useTranslations('marketplace.install');
  return (
    <div className="space-y-2">
      <ErrorLine error={error} />
      {failed.kind === 'scopeExceeds' && failed.missingPermissions.length > 0 && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{t('missingPermissions')}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 font-mono text-xs" dir="ltr">
            {failed.missingPermissions.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      {failed.kind === 'alreadyInstalled' && (
        <Link
          href={alreadyId ? mktRoutes.manage(alreadyId) : mktRoutes.installed}
          className={TEXT_LINK}
        >
          {t('openManage')}
        </Link>
      )}
      {(failed.kind === 'planLimitInstalled' || failed.kind === 'planLimit') && (
        <Link href={mktRoutes.installed} className={TEXT_LINK}>
          {t('seeInstalled')}
        </Link>
      )}
    </div>
  );
}

/** "The permissions changed while you were looking": what is new, what is gone. The list below is the current one. */
export function ChangedNotice({
  changes,
}: {
  changes: { diff: ScopeChanges; removed: MarketScopeSummary[] };
}) {
  const t = useTranslations('marketplace.install.changed');
  const { diff, removed } = changes;
  return (
    <Alert tone="warning" data-testid="consent-changed">
      <p className="font-medium">{t('title')}</p>
      <p>{t('message')}</p>
      {diff.added.length > 0 && (
        <p className="mt-1">
          {t('added')} {diff.added.map((s) => s.label).join(', ')}
        </p>
      )}
      {removed.length > 0 && (
        <p className="mt-1">
          {t('removed')} {removed.map((s) => s.label).join(', ')}
        </p>
      )}
      {diff.changedIds.length > 0 && <p className="mt-1">{t('edited')}</p>}
    </Alert>
  );
}

/** The signed-in person lacks permission keys the scopes stand for. A warning only; the API decides. */
export function GapsNotice({ keys }: { keys: string[] }) {
  const t = useTranslations('marketplace.install');
  return (
    <Alert tone="warning" data-testid="installer-gaps">
      <p className="font-medium">{t('gaps.title')}</p>
      <p>{t('gaps.message')}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 font-mono text-xs" dir="ltr">
        {keys.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
    </Alert>
  );
}

export function DoneStep({
  app,
  done,
  reveal,
  onReveal,
}: {
  app: MarketAppDetail;
  done: Done;
  reveal: RevealState;
  onReveal: (s: RevealState) => void;
}) {
  const t = useTranslations('marketplace.install.done');
  return (
    <div className="space-y-5" data-testid="install-done">
      <Alert tone="success">
        <p className="font-medium">{t('title', { name: app.name })}</p>
        <p>{t('message', { version: done.version })}</p>
      </Alert>
      <SecretReveal state={reveal} onState={onReveal} doneLabel={t('saved')} />
      {reveal.phase !== 'shown' && (
        <div className="flex flex-wrap gap-2">
          <Link href={mktRoutes.manage(done.installationId)} className={LINK_BUTTON_PRIMARY}>
            {t('manage')}
          </Link>
          <Link href={mktRoutes.browse(app.kind)} className={LINK_BUTTON}>
            {t('browse')}
          </Link>
        </div>
      )}
    </div>
  );
}
