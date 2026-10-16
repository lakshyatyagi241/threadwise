'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { LeadSourceResponse } from '@crm/contracts';
import { Alert, Badge, Button, Card, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { deleteSource, fetchSource, leadKeys, rotateToken, updateSource } from '../api';
import {
  allProblems,
  buildUpdateBody,
  draftFromSource,
  isDirty,
  type Problems,
  type SourceDraft,
} from '../lib/draft';
import { issuesByPath, leadError, type LeadError } from '../lib/errors';
import { DEFAULT_EVENT_FILTERS, filtersFromLink, type EventFilters } from '../lib/event-view';
import type { HookUrlEnv } from '../lib/hook-url';
import { LEADS_READ, useLeadsCan } from '../lib/permissions';
import { dismissReveal, needsLeaveGuard, revealOf, type Reveal } from '../lib/reveal';
import {
  ROUTES,
  canDeleteHere,
  canRotate,
  hasOwnUrl,
  isConnector,
  isMetaForm,
  tokenHintOf,
} from '../lib/source-view';
import { EventsPanel } from './events-panel';
import { MetaHealthCard } from './meta-health-card';
import { MappingStudio, usePathFocus } from './mapping-studio';
import { RevealPanel } from './reveal-panel';
import { BasicsFields, DefaultsFields, type SetDraft } from './source-fields';
import { TestLeadPanel } from './test-lead-panel';
import {
  ErrorText,
  KindBadge,
  Loading,
  ManageNote,
  NoAccess,
  RegionError,
  SourceStatusChip,
  When,
} from './ui';

/**
 * `/lead-sources/[id]`: one source. Its header (status, needs-attention count, last event) and actions (pause or resume, rotate the
 * token, delete), the events it received, a test lead, and its settings (basics, what happens to a lead, the mapping with its live
 * preview). Changes carry the rowVersion the page loaded; a 409 means someone else changed it and offers a reload, never a merge.
 */
export function SourceDetailPage({
  id,
  hookEnv,
  initialEvents,
}: {
  id: string;
  hookEnv: HookUrlEnv;
  /** The address's `?events=` value (the "needs attention" badge links with `attention`). */
  initialEvents?: string;
}) {
  const t = useTranslations('lead-sources.detail');
  const can = useLeadsCan();
  const q = useQuery({
    queryKey: leadKeys.one(id),
    queryFn: ({ signal }) => fetchSource(id, signal),
    enabled: can.read,
    retry: false,
  });

  if (!can.read) return <NoAccess permission={LEADS_READ} />;
  if (q.isPending) return <Loading label={t('loading')} />;
  if (q.isError) {
    return (
      <div className="space-y-4">
        <RegionError error={q.error} onRetry={() => void q.refetch()} />
        <Link href={ROUTES.webhooks} className="text-sm text-primary underline underline-offset-2">
          {t('backToList')}
        </Link>
      </div>
    );
  }
  return <Detail first={q.data} live={q.data} hookEnv={hookEnv} initialEvents={initialEvents} />;
}

function Detail({
  first,
  live,
  hookEnv,
  initialEvents,
}: {
  first: LeadSourceResponse;
  /** The source as the cache holds it now: counts and the last event stay current without touching the editor. */
  live: LeadSourceResponse;
  hookEnv: HookUrlEnv;
  initialEvents?: string;
}) {
  const t = useTranslations('lead-sources.detail');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useLeadsCan();

  // `base` is the version this page last loaded or saved: every write carries its rowVersion, so a change somebody else made in the
  // meantime is a 409, not a silent overwrite. A background refresh updates `live`, never `base`.
  const [base, setBase] = useState(first);
  const [draft, setDraft] = useState<SourceDraft>(() => draftFromSource(first));
  const [showProblems, setShowProblems] = useState(false);
  const [failure, setFailure] = useState<LeadError | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [confirm, setConfirm] = useState<'pause' | 'rotate' | 'delete' | null>(null);
  const [filters, setFilters] = useState<EventFilters>(
    initialEvents ? filtersFromLink(initialEvents) : DEFAULT_EVENT_FILTERS,
  );

  const set: SetDraft = (fn) => setDraft(fn);
  const focus = usePathFocus(draft, set);
  const baseline = draftFromSource(base);
  const dirty = isDirty(draft, baseline);
  const connector = isConnector(base);
  const meta = isMetaForm(base);
  // Connectors and Meta forms both receive leads without a URL of their own: no secret and no sender id path to edit.
  const noUrl = !hasOwnUrl(base);

  // Unsaved edits and an unconfirmed token both die with the page: the browser asks first.
  useEffect(() => {
    if (!dirty && !needsLeaveGuard(reveal)) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, reveal]);

  // Arriving from the "needs attention" badge lands on the events.
  useEffect(() => {
    if (initialEvents === 'attention') document.getElementById('events')?.scrollIntoView();
  }, [initialEvents]);

  const accept = (source: LeadSourceResponse) => {
    setBase(source);
    qc.setQueryData(leadKeys.one(source.id), source);
    void qc.invalidateQueries({ queryKey: leadKeys.list });
  };

  const save = useMutation({
    mutationFn: () => updateSource(base.id, buildUpdateBody(draft, base.rowVersion)),
    onSuccess: (source) => {
      accept(source);
      setDraft(draftFromSource(source));
      setShowProblems(false);
      setFailure(null);
      toast(t('saved'));
    },
    onError: (error) => setFailure(leadError(error)),
  });

  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      updateSource(base.id, { rowVersion: base.rowVersion, status }),
    onSuccess: (source) => {
      accept(source);
      setConfirm(null);
      setFailure(null);
      toast(source.status === 'paused' ? t('pausedToast') : t('resumedToast'));
    },
    onError: (error) => {
      setConfirm(null);
      setFailure(leadError(error));
    },
  });

  const rotate = useMutation({
    mutationFn: async () => {
      const { source, secrets } = await rotateToken(base.id);
      // The new token goes to this component's state and nowhere else; the mutation's own result is the source alone.
      setReveal(revealOf(secrets, 'rotated'));
      return source;
    },
    onSuccess: (source) => {
      accept(source);
      setConfirm(null);
      setFailure(null);
    },
    onError: (error) => {
      setConfirm(null);
      setFailure(leadError(error));
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteSource(base.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: leadKeys.one(base.id) });
      qc.removeQueries({ queryKey: leadKeys.eventsOf(base.id) });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      toast(t('deletedToast', { name: base.name }));
      router.push(ROUTES.webhooks);
    },
    onError: (error) => {
      setConfirm(null);
      setFailure(leadError(error));
    },
  });

  const reload = async () => {
    const fresh = await qc.fetchQuery({
      queryKey: leadKeys.one(base.id),
      queryFn: ({ signal }) => fetchSource(base.id, signal),
      staleTime: 0,
    });
    setBase(fresh);
    setDraft(draftFromSource(fresh));
    setFailure(null);
    setShowProblems(false);
  };

  const problems: Problems = showProblems ? allProblems(draft, 'update') : {};
  const server = issuesByPath(failure);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!can.manage) return;
    if (Object.keys(allProblems(draft, 'update')).length > 0) {
      setShowProblems(true);
      return;
    }
    setFailure(null);
    save.mutate();
  };

  const hint = tokenHintOf(live);
  const busy = save.isPending || setStatus.isPending || rotate.isPending || remove.isPending;
  const paused = live.status === 'paused';

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href={ROUTES.webhooks}
          className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('backToList')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h1 className="break-words text-2xl font-semibold" dir="auto">
              {live.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <KindBadge kind={live.kind} />
              <SourceStatusChip status={live.status} />
              {live.needsAttention > 0 && (
                <a
                  href="#events"
                  data-testid="header-attention"
                  onClick={() => setFilters({ status: 'attention', tests: 'hide' })}
                  className="focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Badge tone="warning">
                    {t('needsAttention', { count: live.needsAttention })}
                  </Badge>
                </a>
              )}
              <span className="text-xs text-muted-foreground">
                {t('lastEvent')} <When value={live.lastEventAt} empty={t('noEvents')} />
              </span>
            </div>
          </div>
          {can.manage && (
            <div className="flex flex-wrap items-center gap-2">
              {paused ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setStatus.mutate('active')}
                >
                  {setStatus.isPending && <Spinner />}
                  {t('resume')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm('pause')}
                >
                  {t('pause')}
                </Button>
              )}
              {canRotate(live) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm('rotate')}
                >
                  {t('rotate')}
                </Button>
              )}
              {canDeleteHere(live) && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirm('delete')}
                >
                  {t('delete')}
                </Button>
              )}
            </div>
          )}
        </div>
        <ManageNote can={can} />
      </header>

      {failure && failure.kind === 'conflict' ? (
        <Alert tone="warning" className="space-y-2" data-testid="conflict">
          <p>{t('conflict')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void reload()}>
            {t('reload')}
          </Button>
        </Alert>
      ) : failure && (failure.kind !== 'field' || failure.issues.length === 0) ? (
        <ErrorText mapped={failure} />
      ) : null}

      {reveal && (
        <RevealPanel
          reveal={reveal}
          env={hookEnv}
          hasSecret={base.hasSecret}
          onChange={setReveal}
          onDone={() => setReveal(dismissReveal(reveal))}
        />
      )}

      <section aria-labelledby="ls-conn-title" className="space-y-2">
        <h2 id="ls-conn-title" className="text-lg font-semibold">
          {t('connection')}
        </h2>
        {meta ? (
          <Alert tone="info" className="space-y-2" data-testid="meta-note">
            <p>{t('metaForm')}</p>
            <Link href={ROUTES.ads} className="font-medium underline underline-offset-2">
              {t('metaFormLink')}
            </Link>
          </Alert>
        ) : connector ? (
          <Alert tone="info" className="space-y-2" data-testid="connector-note">
            <p>{t('connector')}</p>
            <Link
              href={ROUTES.marketplaceInstalled}
              className="font-medium underline underline-offset-2"
            >
              {t('connectorLink')}
            </Link>
          </Alert>
        ) : (
          <Card className="space-y-2 text-sm">
            <p>
              {hint ? (
                <span dir="ltr">{t('endsIn', { hint })}</span>
              ) : (
                <span className="text-muted-foreground">{t('noHint')}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{t('urlOnce')}</p>
            <p className="text-xs text-muted-foreground">
              {base.hasSecret ? t('secretYes') : t('secretNo')}
            </p>
            {paused && <p className="text-xs text-warning">{t('pausedNote')}</p>}
          </Card>
        )}
      </section>

      {meta && <MetaHealthCard sourceId={base.id} enabled={can.read} />}

      <EventsPanel source={live} can={can} filters={filters} onFilters={setFilters} />

      <TestLeadPanel source={live} canManage={can.manage} />

      <form onSubmit={submit} noValidate aria-label={t('settings')} className="space-y-8">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('settings')}</h2>
          <p className="text-sm text-muted-foreground">{t('settingsHelp')}</p>
        </div>

        <section aria-labelledby="ls-basics-title" className="space-y-4">
          <h3 id="ls-basics-title" className="text-base font-semibold">
            {t('basics')}
          </h3>
          <BasicsFields
            draft={draft}
            set={set}
            problems={problems}
            server={server}
            disabled={!can.manage}
            hasSecret={base.hasSecret}
            onFocusTarget={focus.setFocus}
            connector={noUrl}
          />
        </section>

        <section aria-labelledby="ls-rules-title" className="space-y-4">
          <h3 id="ls-rules-title" className="text-base font-semibold">
            {t('rules')}
          </h3>
          <DefaultsFields
            draft={draft}
            set={set}
            problems={problems}
            server={server}
            disabled={!can.manage}
          />
        </section>

        <section aria-labelledby="ls-mapping-title" className="space-y-4">
          <h3 id="ls-mapping-title" className="text-base font-semibold">
            {t('mapping')}
          </h3>
          <MappingStudio
            sourceId={base.id}
            draft={draft}
            set={set}
            problems={problems}
            server={server}
            disabled={!can.manage}
            canPreview={can.manage}
            focus={focus}
          />
        </section>

        {can.manage && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background py-3">
            {dirty && <span className="me-auto text-xs text-muted-foreground">{t('unsaved')}</span>}
            <Button
              type="button"
              variant="secondary"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(draftFromSource(base));
                setShowProblems(false);
                setFailure(null);
              }}
            >
              {t('discard')}
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending && <Spinner />}
              {t('save')}
            </Button>
          </div>
        )}
      </form>

      {can.manage && (
        <>
          <ConfirmDialog
            open={confirm === 'pause'}
            title={t('confirm.pause.title')}
            message={t('confirm.pause.body')}
            confirmLabel={t('confirm.pause.action')}
            cancelLabel={t('confirm.cancel')}
            busy={setStatus.isPending}
            onConfirm={() => setStatus.mutate('paused')}
            onClose={() => setConfirm(null)}
          />
          {canRotate(base) && (
            <ConfirmDialog
              open={confirm === 'rotate'}
              tone="danger"
              title={t('confirm.rotate.title')}
              message={t('confirm.rotate.body')}
              confirmLabel={t('confirm.rotate.action')}
              cancelLabel={t('confirm.cancel')}
              busy={rotate.isPending}
              onConfirm={() => rotate.mutate()}
              onClose={() => setConfirm(null)}
            />
          )}
          {canDeleteHere(base) && (
            <ConfirmDialog
              open={confirm === 'delete'}
              tone="danger"
              title={t('confirm.delete.title', { name: base.name })}
              message={t('confirm.delete.body')}
              confirmLabel={t('confirm.delete.action')}
              cancelLabel={t('confirm.cancel')}
              busy={remove.isPending}
              onConfirm={() => remove.mutate()}
              onClose={() => setConfirm(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
