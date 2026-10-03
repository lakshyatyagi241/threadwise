'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  marketConnectionEventSchema,
  type MarketInstallation,
  type MarketSampleLeadResult,
  type MarketTestResult,
} from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Input, Spinner, StatTile } from '@crm/ui';
import { useCursorList } from '@/lib/api/use-cursor-list';
import { mktKeys, rotateSecret, sendSampleLead, testInstallation } from '../api';
import type { ManageView } from '../lib/manage';
import { mktError } from '../lib/errors';
import { startReveal, type RevealState } from '../lib/secret-reveal';
import { parseEndsIn } from '../lib/setup-form';
import { ProblemNotice } from './manage-parts';
import { SecretReveal } from './secret-reveal';
import { CopyButton, ErrorLine, ErrorPanel, LoadingBlock, NeedsPermission, Section } from './ui';
import { useAsyncAction } from './use-async-action';

const EVENT_TONE = {
  accepted: 'success',
  duplicate: 'neutral',
  rejected: 'warning',
  failed: 'danger',
} as const;

/** The connection of an installation: where senders post, how it is doing, the counters, and the test, sample and rotate actions. */
export function ConnectionPanel({
  installation,
  view,
  onRotated,
  onTested,
  onReload,
}: {
  installation: MarketInstallation;
  view: ManageView;
  /** The installation answer of a rotation (it never holds the secret; the secret stays in this component's state). */
  onRotated: (next: MarketInstallation) => void;
  /** A connection test changes the installation health on the server: reload it. */
  onTested: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('marketplace.manage.connection');
  const f = useFormatter();
  const c = installation.connection;
  if (!c) return null;
  const when = (iso: string | null) =>
    iso ? f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('never');
  return (
    <Section title={t('title')} description={t('intro')}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="connection">
        <Fact label={t('type')}>{t(`types.${c.type}`)}</Fact>
        <Fact label={t('status')}>
          <Badge
            tone={c.status === 'active' ? 'success' : c.status === 'error' ? 'danger' : 'warning'}
          >
            {t(`statuses.${c.status}`)}
          </Badge>
        </Fact>
        {c.pollIntervalSeconds !== null && (
          <Fact label={t('pollEvery')}>{t('seconds', { count: c.pollIntervalSeconds })}</Fact>
        )}
        <Fact label={t('lastEvent')}>{when(c.lastEventAt)}</Fact>
        <Fact label={t('lastSuccess')}>{when(c.lastSuccessAt)}</Fact>
        {c.lastError && (
          <Fact label={t('lastError')}>
            <span className="text-danger">{c.lastError}</span>
          </Fact>
        )}
      </dl>

      {c.inbound && <InboundBlock inbound={c.inbound} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="counters">
        <StatTile label={t('counters.received')} value={c.counters.received} />
        <StatTile label={t('counters.accepted')} value={c.counters.accepted} />
        <StatTile label={t('counters.duplicates')} value={c.counters.duplicates} />
        <StatTile
          label={t('counters.failed')}
          value={c.counters.failed}
          tone={c.counters.failed > 0 ? 'warning' : 'default'}
        />
      </div>

      <Actions
        installation={installation}
        view={view}
        onRotated={onRotated}
        onTested={onTested}
        onReload={onReload}
      />
    </Section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

/** The address a sender posts to and how it authenticates. Only the secret's tail is known here; the secret itself is shown at install and rotate. */
function InboundBlock({
  inbound,
}: {
  inbound: NonNullable<NonNullable<MarketInstallation['connection']>['inbound']>;
}) {
  const t = useTranslations('marketplace.manage.connection.inbound');
  const last = parseEndsIn(inbound.secretHint);
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <div className="space-y-1.5">
        <label htmlFor="mkt-inbound-url" className="block font-medium">
          {t('address')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="mkt-inbound-url"
            readOnly
            dir="ltr"
            value={inbound.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 basis-64 font-mono text-xs"
          />
          <CopyButton value={inbound.url} label={t('copyAddress')} />
        </div>
        <p className="text-xs text-muted-foreground">{t('method')}</p>
      </div>
      <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
        {inbound.auth !== 'hmac' && <li>{t('token', { header: inbound.tokenHeader })}</li>}
        {inbound.auth !== 'token' && <li>{t('signature', { header: inbound.signatureHeader })}</li>}
      </ul>
      <p className="text-muted-foreground">
        {last
          ? t('secretEndsIn', { last })
          : inbound.secretHint
            ? inbound.secretHint
            : t('secretSet')}
      </p>
    </div>
  );
}

function Actions({
  installation,
  view,
  onRotated,
  onTested,
  onReload,
}: {
  installation: MarketInstallation;
  view: ManageView;
  onRotated: (next: MarketInstallation) => void;
  onTested: () => void;
  onReload: () => void;
}) {
  const t = useTranslations('marketplace.manage.connection.actions');
  const test = useAsyncAction();
  const sample = useAsyncAction();
  const rotate = useAsyncAction();
  const [testResult, setTestResult] = useState<MarketTestResult | null>(null);
  const [sampleResult, setSampleResult] = useState<MarketSampleLeadResult | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [reveal, setReveal] = useState<RevealState>({ phase: 'none' });

  const runTest = async () => {
    setTestResult(null);
    const out = await test.run(() => testInstallation(installation.id));
    if (out.ok) {
      setTestResult(out.value);
      onTested();
    }
  };
  const runSample = async () => {
    setSampleResult(null);
    const out = await sample.run(() => sendSampleLead(installation.id, {}));
    if (out.ok) setSampleResult(out.value);
  };
  const runRotate = async () => {
    const out = await rotate.run(() => rotateSecret(installation.id, installation.rowVersion));
    setConfirmRotate(false);
    if (!out.ok) return;
    const inbound = out.value.installation.connection?.inbound ?? null;
    // The new secret goes into this component's state and nowhere else; the cache gets the installation without it.
    setReveal(
      startReveal(
        out.value.inboundSecret
          ? {
              secret: out.value.inboundSecret,
              url: inbound?.url ?? null,
              tokenHeader: inbound?.tokenHeader ?? null,
              signatureHeader: inbound?.signatureHeader ?? null,
              auth: inbound?.auth ?? null,
            }
          : null,
      ),
    );
    onRotated(out.value.installation);
  };

  if (!view.canTest && !view.canSample && !view.canRotate) {
    return view.missing.manage ? <NeedsPermission permission="market.apps.manage" /> : null;
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {view.canTest && (
          <Button variant="secondary" onClick={() => void runTest()} disabled={test.pending}>
            {test.pending && <Spinner />}
            {t('test')}
          </Button>
        )}
        {view.canSample && (
          <Button variant="secondary" onClick={() => void runSample()} disabled={sample.pending}>
            {sample.pending && <Spinner />}
            {t('sample')}
          </Button>
        )}
        {view.canRotate && (
          <Button
            variant="secondary"
            onClick={() => setConfirmRotate(true)}
            disabled={rotate.pending}
          >
            {t('rotate')}
          </Button>
        )}
      </div>
      {installation.status === 'disabled' && view.canTest && !view.canSample && (
        <p className="text-xs text-muted-foreground">{t('sampleNeedsActive')}</p>
      )}

      <div aria-live="polite" className="space-y-2">
        {testResult && (
          <Alert tone={testResult.ok ? 'success' : 'danger'} data-testid="test-result">
            <p className="font-medium">
              {testResult.ok ? t('testOk') : t('testFailed')}
              <span className="ms-2 text-xs font-normal">
                {t('latency', { ms: testResult.latencyMs })}
              </span>
            </p>
            {!testResult.ok && (testResult.message || testResult.code) && (
              <p className="mt-0.5">
                {testResult.message}
                {testResult.code && (
                  <span className="ms-2 font-mono text-xs">{testResult.code}</span>
                )}
              </p>
            )}
          </Alert>
        )}
        {sampleResult && (
          <Alert tone="success" data-testid="sample-result">
            <p className="font-medium">
              {sampleResult.status === 'accepted' ? t('sampleAccepted') : t('sampleDuplicate')}
            </p>
            <p className="font-mono text-xs" dir="ltr">
              {sampleResult.externalId}
            </p>
          </Alert>
        )}
      </div>
      {test.error ? <ErrorLine error={test.error} /> : null}
      {sample.error ? <ProblemNotice error={sample.error} onReload={onReload} /> : null}
      {rotate.error ? <RotateProblem error={rotate.error} onReload={onReload} /> : null}

      <SecretReveal state={reveal} onState={setReveal} doneLabel={t('rotatedDone')} />

      <ConfirmDialog
        open={confirmRotate}
        tone="danger"
        title={t('rotateConfirm.title')}
        message={t('rotateConfirm.message')}
        confirmLabel={t('rotateConfirm.confirm')}
        cancelLabel={t('rotateConfirm.cancel')}
        busy={rotate.pending}
        onConfirm={() => void runRotate()}
        onClose={() => setConfirmRotate(false)}
      />
    </div>
  );
}

/** A rotation the server refuses because the secret is the portal's own credential says where to change it instead. */
function RotateProblem({ error, onReload }: { error: unknown; onReload: () => void }) {
  const t = useTranslations('marketplace.manage.connection.actions');
  if (mktError(error).kind === 'noConnection') {
    return <Alert tone="warning">{t('rotateNotApplicable')}</Alert>;
  }
  return <ProblemNotice error={error} onReload={onReload} />;
}

/** Recent deliveries: newest first, "Load more" through the cursor. */
export function EventsPanel({ installationId }: { installationId: string }) {
  const t = useTranslations('marketplace.manage.events');
  const f = useFormatter();
  const list = useCursorList(
    mktKeys.events(installationId),
    `/marketplace/installations/${installationId}/events`,
    marketConnectionEventSchema,
    { limit: 25 },
  );
  return (
    <Section
      title={t('title')}
      description={t('intro')}
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          {list.isFetching && <Spinner />}
          {t('refresh')}
        </Button>
      }
    >
      {list.isPending ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorPanel error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState title={t('empty.title')} message={t('empty.message')} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm" data-testid="events">
              <thead>
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.received')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.status')}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start font-medium">
                    {t('columns.externalId')}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {t('columns.error')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pe-3 whitespace-nowrap">
                      {f.dateTime(new Date(e.receivedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="py-2 pe-3">
                      <Badge tone={EVENT_TONE[e.status]}>{t(`status.${e.status}`)}</Badge>
                    </td>
                    <td className="py-2 pe-3 font-mono text-xs break-all" dir="ltr">
                      {e.externalId ?? '—'}
                    </td>
                    <td className="py-2 text-muted-foreground">{e.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
