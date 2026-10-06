'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { FormSummary } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Spinner,
  StatTile,
  cn,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { deleteForm, duplicateForm, formAction, KEYS, useForms } from '../api/forms';
import { errorKind } from '../lib/errors';
import {
  conversionRate,
  filtersForView,
  isListView,
  LIST_VIEWS,
  relativeTime,
  rowActions,
  STATUS_TONE,
  totals,
  type ListView,
  type RowAction,
} from '../lib/list-model';
import { NewFormDialog, type StartMode } from './new-form-dialog';

const hostedOrigin = () => (typeof window === 'undefined' ? '' : window.location.origin);

function Dots() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="13" cy="8" r="1.3" />
    </svg>
  );
}

/**
 * `/forms`: every form of the workspace with its status, submissions and conversion, the way in to a new form (template or blank)
 * and the row actions (open, copy link, embed, duplicate, pause, archive). The views above the list filter on the server.
 */
export function FormsScreen() {
  const t = useTranslations('web-forms.list');
  const e = useTranslations('web-forms.errors');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canCreate = useCan('record.forms.create');
  const canUpdate = useCan('record.forms.update');
  const canDelete = useCan('record.forms.delete');
  const canSubmissions = useCan('record.form-submissions.read');

  const viewParam = params.get('view');
  const view: ListView = isListView(viewParam) ? viewParam : 'all';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  // The server filters; the box waits a moment so typing does not fire a request per letter.
  useEffect(() => {
    const id = window.setTimeout(() => setQ(search), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const filters = useMemo(() => filtersForView(view, q), [view, q]);
  const list = useForms(filters);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const sums = useMemo(() => totals(rows), [rows]);

  const [dialog, setDialog] = useState<{ mode: StartMode; template: string | null } | null>(null);
  const [pendingArchive, setPendingArchive] = useState<FormSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setView = (next: ListView) => {
    const sp = new URLSearchParams(params.toString());
    if (next === 'all') sp.delete('view');
    else sp.set('view', next);
    router.replace(sp.size ? `/forms?${sp.toString()}` : '/forms');
  };

  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });
  const fail = (err: unknown) => {
    const kind = errorKind(err);
    toast(kind === 'planLimit' ? e('planLimitForms') : e(kind), 'danger');
  };

  const run = async (f: FormSummary, work: () => Promise<unknown>, done: string) => {
    setBusy(f.id);
    try {
      await work();
      refresh();
      toast(done, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (f: FormSummary) => {
    const url = `${hostedOrigin()}/f/${f.publicKey}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('copied'), 'success');
    } catch {
      toast(t('copyBlocked', { url }), 'info');
    }
  };

  const act = (f: FormSummary, action: RowAction) => {
    switch (action) {
      case 'edit':
        return router.push(`/forms/${f.id}`);
      case 'submissions':
        return router.push(`/forms/${f.id}/submissions`);
      case 'embed':
        return router.push(`/forms/${f.id}?tab=share`);
      case 'copyLink':
        return void copyLink(f);
      case 'duplicate':
        setBusy(f.id);
        return void duplicateForm(f.id, f.rowVersion)
          .then((copy) => {
            refresh();
            router.push(`/forms/${copy.id}`);
          })
          .catch((err: unknown) => {
            fail(err);
            setBusy(null);
          });
      case 'pause':
        return void run(f, () => formAction(f.id, 'pause', f.rowVersion), t('paused'));
      case 'resume':
        return void run(f, () => formAction(f.id, 'resume', f.rowVersion), t('resumed'));
      // The API's resume also brings an archived form back (to paused: nothing is public until the owner resumes it again).
      case 'restore':
        return void run(f, () => formAction(f.id, 'resume', f.rowVersion), t('restored'));
      case 'archive':
        return setPendingArchive(f);
      case 'delete':
        return setPendingDelete(f);
    }
  };

  const allowed = (a: RowAction): boolean => {
    if (a === 'edit' || a === 'copyLink' || a === 'embed') return true;
    if (a === 'submissions') return canSubmissions;
    if (a === 'duplicate') return canCreate;
    if (a === 'delete') return canDelete;
    return canUpdate;
  };

  const empty = !list.isPending && !list.isError && rows.length === 0;
  const unfiltered = view === 'all' && q === '';

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/forms/templates"
            className="inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('templates')}
          </Link>
          {canCreate && (
            <Button onClick={() => setDialog({ mode: 'template', template: null })}>
              {t('newForm')}
            </Button>
          )}
        </div>
      </header>

      {!list.isPending && !list.isError && (rows.length > 0 || !unfiltered) && (
        <section
          aria-label={t('statsLabel')}
          className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <StatTile label={t('stats.forms')} value={sums.forms} />
          <StatTile label={t('stats.published')} value={sums.published} tone="accent" />
          <StatTile label={t('stats.submissions')} value={sums.submissions} />
          <StatTile
            label={t('stats.needsReview')}
            value={sums.needsReview}
            tone={sums.needsReview > 0 ? 'warning' : 'default'}
          />
        </section>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('views.label')} className="flex flex-wrap gap-1">
          {LIST_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-9 rounded-full px-3.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="forms-search" className="sr-only">
            {t('search')}
          </label>
          <Input
            id="forms-search"
            type="search"
            value={search}
            placeholder={t('search')}
            onChange={(ev) => setSearch(ev.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        {list.isPending && (
          <div className="flex justify-center py-16">
            <Spinner label={t('loading')} />
          </div>
        )}

        {list.isError && (
          <Alert tone="danger" className="flex items-center justify-between gap-3">
            <span>
              {errorKind(list.error) === 'planLocked' ? e('planLocked') : t('loadFailed')}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
              {t('retry')}
            </Button>
          </Alert>
        )}

        {empty && unfiltered && (
          <EmptyState
            title={t('empty.title')}
            message={t('empty.message')}
            actions={
              canCreate ? (
                <>
                  <Button onClick={() => setDialog({ mode: 'template', template: null })}>
                    {t('empty.fromTemplate')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setDialog({ mode: 'blank', template: null })}
                  >
                    {t('empty.blank')}
                  </Button>
                </>
              ) : undefined
            }
          />
        )}
        {empty && !unfiltered && (
          <EmptyState
            title={t('noMatch.title')}
            message={t('noMatch.message')}
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setView('all');
                }}
              >
                {t('noMatch.clear')}
              </Button>
            }
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border bg-background">
            <div
              className="hidden grid-cols-[minmax(0,2fr)_110px_100px_100px_110px_minmax(0,1fr)_48px] gap-3 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid"
              aria-hidden="true"
            >
              <span>{t('col.name')}</span>
              <span>{t('col.status')}</span>
              <span className="text-end">{t('col.submissions')}</span>
              <span className="text-end">{t('col.views')}</span>
              <span className="text-end">{t('col.conversion')}</span>
              <span>{t('col.last')}</span>
              <span />
            </div>
            <ul>
              {rows.map((f) => {
                const rate = conversionRate(f);
                const last = relativeTime(f.lastSubmissionAt, locale);
                const actions = rowActions(f.status).filter(allowed);
                return (
                  <li
                    key={f.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_110px_100px_100px_110px_minmax(0,1fr)_48px]"
                  >
                    <div className="min-w-0">
                      <Link
                        href={
                          f.status === 'archived' ? `/forms/${f.id}/submissions` : `/forms/${f.id}`
                        }
                        className="block truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        dir="auto"
                      >
                        {f.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {f.hasUnpublishedChanges && f.status !== 'draft' && (
                          <Badge tone="warning">{t('unpublished')}</Badge>
                        )}
                        {f.publishedVersion !== null && (
                          <span>{t('version', { n: f.publishedVersion })}</span>
                        )}
                        {f.needsReview > 0 && (
                          <Link
                            href={`/forms/${f.id}/submissions?tab=needs_attention`}
                            className="font-medium text-warning underline-offset-2 hover:underline"
                          >
                            {t('needsReview', { count: f.needsReview })}
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="row-start-1 justify-self-end md:row-auto md:justify-self-start">
                      <Badge tone={STATUS_TONE[f.status]}>{t(`status.${f.status}`)}</Badge>
                    </div>
                    <dl className="col-span-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground md:contents">
                      <div className="flex gap-1 md:block md:text-end md:text-sm md:text-foreground">
                        <dt className="md:sr-only">{t('col.submissions')}</dt>
                        <dd className="tabular-nums">{f.submissions}</dd>
                      </div>
                      <div className="flex gap-1 md:block md:text-end md:text-sm md:text-foreground">
                        <dt className="md:sr-only">{t('col.views')}</dt>
                        <dd className="tabular-nums">{f.views}</dd>
                      </div>
                      <div className="flex gap-1 md:block md:text-end md:text-sm md:text-foreground">
                        <dt className="md:sr-only">{t('col.conversion')}</dt>
                        <dd className="tabular-nums">{rate === null ? t('noRate') : `${rate}%`}</dd>
                      </div>
                      <div className="flex gap-1 md:block md:text-sm md:text-foreground">
                        <dt className="md:sr-only">{t('col.last')}</dt>
                        <dd title={f.lastSubmissionAt ?? undefined}>{last ?? t('never')}</dd>
                      </div>
                    </dl>
                    <div className="col-start-2 row-start-1 md:col-auto md:row-auto md:justify-self-end">
                      {actions.length > 0 && (
                        <Menu
                          label={t('actionsFor', { name: f.name })}
                          align="end"
                          trigger={<Dots />}
                          disabled={busy === f.id}
                          triggerClassName="size-9 px-0"
                        >
                          {actions.map((a, i) => (
                            <span key={a} className="contents">
                              {(a === 'archive' || a === 'delete') && i > 0 && <MenuSeparator />}
                              <MenuItem danger={a === 'delete'} onSelect={() => act(f, a)}>
                                {t(`action.${a}`)}
                              </MenuItem>
                            </span>
                          ))}
                        </Menu>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {list.hasNextPage && (
          <div className="mt-4 flex justify-center">
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
      </div>

      <NewFormDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        mode={dialog?.mode ?? 'template'}
        onMode={(mode) => setDialog((d) => (d ? { ...d, mode } : d))}
        templateKey={dialog?.template ?? null}
        onTemplate={(template) => setDialog((d) => (d ? { ...d, template } : d))}
      />

      <ConfirmDialog
        open={pendingArchive !== null}
        title={t('archive.title')}
        message={t('archive.message', { name: pendingArchive?.name ?? '' })}
        confirmLabel={t('archive.confirm')}
        cancelLabel={t('cancel')}
        busy={busy !== null && busy === pendingArchive?.id}
        onClose={() => setPendingArchive(null)}
        onConfirm={() => {
          const f = pendingArchive;
          if (!f) return;
          void run(f, () => formAction(f.id, 'archive', f.rowVersion), t('archived')).then(() =>
            setPendingArchive(null),
          );
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        title={t('delete.title')}
        message={t('delete.message', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('cancel')}
        busy={busy !== null && busy === pendingDelete?.id}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const f = pendingDelete;
          if (!f) return;
          void run(f, () => deleteForm(f.id), t('deleted')).then(() => setPendingDelete(null));
        }}
      />
    </main>
  );
}
