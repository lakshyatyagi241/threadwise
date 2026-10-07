'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import type { WidgetListItem } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { deleteWidget, duplicateWidget, KEYS, rotateWidgetToken, useWidgets } from '../api/widgets';
import {
  accentFor,
  matchesSearch,
  MODE_PILL,
  relativeShort,
  snippetTag,
  stampShort,
  statCards,
  STATUS_FILTERS,
  STATUS_PILL,
  type StatusFilter,
} from '../lib/list-model';
import {
  ChatIcon,
  CopyIcon,
  DuplicateIcon,
  EditIcon,
  EyeIcon,
  PlusIcon,
  RotateIcon,
  SearchIcon,
  TrashIcon,
} from './icons';
import { PlanPaywall } from './plan-paywall';

const reason = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const GRID =
  'grid grid-cols-[minmax(240px,1.6fr)_100px_120px_80px_110px_210px] min-w-[900px] items-center gap-3';
const ICON_BTN =
  'inline-flex size-7 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * `/chatbot-widgets` (WD-WGT-001): the status views, four stat cards, and the table of widgets with their row actions.
 * Search filters the rows that are loaded, as WaDesk's did; the status views filter on the server.
 */
export function WidgetsScreen() {
  const t = useTranslations('chatbotWidget.list');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const canCreate = useCan('wgt.widgets.create');
  const canUpdate = useCan('wgt.widgets.update');
  const canDelete = useCan('wgt.widgets.delete');

  // QUIRK: reproduced deliberately (WD-WGT-001). The status views in the rail and the tabs above the table have no click handler
  // and no server filter: "All" is always the highlighted one.
  const filter: StatusFilter = 'all';
  const [q, setQ] = useState('');
  const list = useWidgets();
  const [pendingDelete, setPendingDelete] = useState<WidgetListItem | null>(null);
  const [pendingRotate, setPendingRotate] = useState<WidgetListItem | null>(null);
  const [manualSnippet, setManualSnippet] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // QUIRK: reproduced deliberately (WD-WGT-001 rules 4 and 5, WD-WGT-023). A rotation only updates the copy button's token (the
  // preview link keeps the old one until reload) and a delete only removes the row: the cards and the footer are not touched.
  const [rotated, setRotated] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  // The cards and the status counts come from the unfiltered list's stats, which every page carries.
  const first = list.data?.pages[0];
  const stats = useMemo(() => (first ? statCards(first.stats) : null), [first]);
  const rows = useMemo(
    () =>
      (list.data?.pages.flatMap((p) => p.data) ?? []).filter(
        (w) => !removed.has(w.id) && matchesSearch(w, q),
      ),
    [list.data, q, removed],
  );
  const loadedCount = list.data?.pages.reduce((n, p) => n + p.data.length, 0) ?? 0;
  const shownTotal = stats?.total ?? 0;

  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });

  const copySnippet = async (w: WidgetListItem) => {
    const tag = snippetTag(rotated[w.id] ?? w.embedUrl);
    try {
      await navigator.clipboard.writeText(tag);
      toast(t('copied', { tag: '</body>' }), 'success');
    } catch {
      setManualSnippet(tag);
    }
  };

  const duplicate = async (w: WidgetListItem) => {
    setBusy(w.id);
    try {
      const copy = await duplicateWidget(w.id);
      refresh();
      router.push(`/chatbot-widgets/${copy.id}/edit`);
    } catch (e) {
      toast(reason(e, t('duplicateFailed')), 'danger');
      setBusy(null);
    }
  };

  const confirmRotate = async () => {
    if (!pendingRotate) return;
    setBusy(pendingRotate.id);
    try {
      const out = await rotateWidgetToken(pendingRotate.id);
      setRotated((m) => ({ ...m, [pendingRotate.id]: out.embedUrl }));
      toast(t('rotated'), 'success');
      setPendingRotate(null);
    } catch (e) {
      toast(t('rotateFailed', { reason: reason(e, t('networkError')) }), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(pendingDelete.id);
    try {
      await deleteWidget(pendingDelete.id);
      setRemoved((r) => new Set(r).add(pendingDelete.id));
      toast(t('deleted'), 'success');
      setPendingDelete(null);
    } catch (e) {
      toast(t('deleteFailed', { reason: reason(e, t('networkError')) }), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const tab = (key: StatusFilter, count: number, className: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-semibold',
        filter === key
          ? 'bg-brand text-brand-foreground'
          : 'text-muted-foreground hover:bg-border/50',
        className,
      )}
    >
      {t(`status.${key}`)} <span className="ms-1 font-mono text-[10px] opacity-80">{count}</span>
    </button>
  );

  const counts: Record<StatusFilter, number> = {
    all: stats?.total ?? 0,
    active: stats?.active ?? 0,
    paused: stats?.paused ?? 0,
  };
  const empty = !list.isPending && !list.isError && loadedCount === 0 && filter === 'all';

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      {first?.planLocked && <PlanPaywall />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-6">
          <div className="rounded-2xl border border-emerald-600/30 bg-emerald-50 p-3 text-xs leading-relaxed text-foreground dark:bg-emerald-950/30">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
              {t('tip')}
            </div>
            {t('tipBody')}
          </div>

          <nav
            aria-label={t('statusViews')}
            className="rounded-2xl border border-border bg-background p-2 shadow-sm"
          >
            <div className={cn(KICKER, 'px-3 pb-1.5 pt-2')}>{t('statusViews')}</div>
            {STATUS_FILTERS.map((key) => {
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm',
                    active ? 'bg-brand font-semibold text-brand-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {key !== 'all' && (
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          key === 'active' ? 'bg-emerald-500' : 'bg-border',
                        )}
                        aria-hidden="true"
                      />
                    )}
                    {t(`view.${key}`)}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      !active && 'text-muted-foreground',
                    )}
                  >
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="rounded-2xl border border-emerald-600/30 bg-emerald-50/60 p-4 text-xs leading-relaxed dark:bg-emerald-950/20">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
              {t('trainFirst')}
            </div>
            {t.rich('trainBody', {
              link: (chunks) => (
                <Link href="/ai-training" className="font-semibold text-brand underline">
                  {chunks}
                </Link>
              ),
            })}
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('workspace')} · {session.org.name}
              </div>
              <h1 className="text-[32px] font-normal leading-none tracking-tight sm:text-[38px] lg:text-[44px]">
                {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-medium text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                {t('activePill', { count: stats?.active ?? 0 })}
              </span>
              {canCreate && (
                <Link
                  href="/chatbot-widgets/create"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
                >
                  <PlusIcon className="size-3.5" />
                  {t('newWidget')}
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('card.total')} value={String(stats?.total ?? '—')}>
              {t('card.activeHint', { count: stats?.active ?? 0 })}
            </StatCard>
            <StatCard
              label={t('card.visitors')}
              value={stats ? stats.visitors.toLocaleString() : '—'}
            >
              {t('card.allTime')}
            </StatCard>
            <StatCard label={t('card.avg')} value={stats?.avgPerWidget ?? '—'}>
              {t('card.visitorsUnit')}
            </StatCard>
            <StatCard
              label={t('card.health')}
              aside={stats ? `${stats.healthPct}%` : undefined}
              value={stats ? t(`health.${stats.health}`) : '—'}
            />
          </div>

          <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div className="flex items-center gap-1 rounded-full bg-muted p-1">
                {tab('all', counts.all, '')}
                {tab('active', counts.active, '')}
                {tab('paused', counts.paused, '')}
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-9 w-full rounded-lg ps-9 text-xs sm:w-72"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <div
                className={cn(
                  GRID,
                  'border-b border-border bg-muted/60 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground',
                )}
              >
                <div>{t('col.widget')}</div>
                <div>{t('col.engine')}</div>
                <div>{t('col.agent')}</div>
                <div>{t('col.visitors')}</div>
                <div>{t('col.updated')}</div>
                <div className="pe-2 text-end">{t('col.actions')}</div>
              </div>

              {list.isPending ? (
                <div className="flex justify-center p-10">
                  <Spinner label={t('loading')} />
                </div>
              ) : list.isError ? (
                <div className="p-4">
                  <EmptyState
                    title={t('loadError')}
                    message={reason(list.error, '')}
                    actions={
                      <Button variant="secondary" onClick={() => void list.refetch()}>
                        {t('retry')}
                      </Button>
                    }
                  />
                </div>
              ) : empty ? (
                <div className="px-6 py-14 text-center">
                  <div className="mb-1 text-xl">{t('emptyTitle')}</div>
                  <p className="mb-4 text-sm text-muted-foreground">{t('emptyBody')}</p>
                  {canCreate && (
                    <Link
                      href="/chatbot-widgets/create"
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
                    >
                      <PlusIcon className="size-3.5" />
                      {t('createWidget')}
                    </Link>
                  )}
                </div>
              ) : rows.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {t('noMatch')}
                </p>
              ) : (
                rows.map((w) => (
                  <WidgetRow
                    key={w.id}
                    w={w}
                    busy={busy === w.id}
                    canCreate={canCreate}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onCopy={() => void copySnippet(w)}
                    onRotate={() => setPendingRotate(w)}
                    onDuplicate={() => void duplicate(w)}
                    onDelete={() => setPendingDelete(w)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <div>
                {t('showing')} <span className="font-mono text-foreground">{loadedCount}</span>{' '}
                {t('of')}{' '}
                <span className="font-mono text-foreground">{shownTotal.toLocaleString()}</span>
              </div>
              <div className="font-mono text-[10.5px]">
                {t('workspace')} · {t('widgetsCount', { count: stats?.total ?? 0 })}
              </div>
            </div>
          </div>

          {list.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                className="rounded-full"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingRotate !== null}
        title={t('rotateTitle')}
        message={t('rotateBody')}
        confirmLabel={t('rotate')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy !== null && pendingRotate !== null}
        onConfirm={() => void confirmRotate()}
        onClose={() => setPendingRotate(null)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteTitle', { name: pendingDelete?.name ?? '' })}
        message={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        tone="danger"
        busy={busy !== null && pendingDelete !== null}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={manualSnippet !== null}
        title={t('copyManuallyTitle')}
        message={<code className="block break-all font-mono text-xs">{manualSnippet}</code>}
        confirmLabel={t('gotIt')}
        cancelLabel={t('close')}
        onConfirm={() => setManualSnippet(null)}
        onClose={() => setManualSnippet(null)}
      />
    </main>
  );
}

function StatCard({
  label,
  value,
  aside,
  children,
}: {
  label: string;
  value: string;
  aside?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className={KICKER}>{label}</span>
        {aside && <span className="font-mono text-[10px] text-brand">{aside}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[30px] leading-none">{value}</span>
        {children && <span className="text-[11px] text-muted-foreground">{children}</span>}
      </div>
    </div>
  );
}

function WidgetRow({
  w,
  busy,
  canCreate,
  canUpdate,
  canDelete,
  onCopy,
  onRotate,
  onDuplicate,
  onDelete,
}: {
  w: WidgetListItem;
  busy: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onCopy: () => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('chatbotWidget.list');
  const mode = MODE_PILL[w.mode];
  const status = STATUS_PILL[w.status];
  return (
    <div
      data-widget-id={w.id}
      className={cn(
        GRID,
        'border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40',
        busy && 'opacity-60',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn('grid size-9 shrink-0 place-items-center rounded-lg', accentFor(w.id))}
          aria-hidden="true"
        >
          <ChatIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/chatbot-widgets/${w.id}/edit`}
              className="min-w-0 truncate text-[12.5px] font-semibold hover:text-brand"
            >
              {w.name}
            </Link>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em]',
                status.box,
              )}
            >
              <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden="true" />
              {t(`pill.${w.status}`)}
            </span>
          </div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">/{w.slug}</div>
        </div>
      </div>

      <div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px]',
            mode.box,
          )}
        >
          <span className={cn('size-1.5 rounded-full', mode.dot)} aria-hidden="true" />
          {mode.label}
        </span>
      </div>

      <div className="truncate text-xs">{w.assistant?.name ?? '—'}</div>

      <div
        className={cn(
          'font-mono text-[11.5px]',
          w.visitors > 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {w.visitors > 0 ? w.visitors.toLocaleString() : '—'}
      </div>

      <div className="min-w-0">
        <div className="truncate font-mono text-[11.5px]">{relativeShort(w.updatedAt)}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {stampShort(w.updatedAt)}
        </div>
      </div>

      <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
        <a
          href={w.previewUrl}
          target="_blank"
          rel="noopener"
          className={cn(ICON_BTN, 'text-brand')}
          title={t('action.preview')}
          aria-label={t('action.preview')}
        >
          <EyeIcon className="size-3.5" />
        </a>
        <button
          type="button"
          className={ICON_BTN}
          title={t('action.copy')}
          aria-label={t('action.copy')}
          onClick={onCopy}
        >
          <CopyIcon className="size-3.5" />
        </button>
        {canUpdate && (
          <Link
            href={`/chatbot-widgets/${w.id}/edit`}
            className={ICON_BTN}
            title={t('action.edit')}
            aria-label={t('action.edit')}
          >
            <EditIcon className="size-3.5" />
          </Link>
        )}
        {canUpdate && (
          <button
            type="button"
            className={cn(ICON_BTN, 'text-amber-700 hover:bg-amber-500/15')}
            title={t('action.rotate')}
            aria-label={t('action.rotate')}
            onClick={onRotate}
          >
            <RotateIcon className="size-3.5" />
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            className={ICON_BTN}
            title={t('action.duplicate')}
            aria-label={t('action.duplicate')}
            disabled={busy}
            onClick={onDuplicate}
          >
            <DuplicateIcon className="size-3.5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className={cn(ICON_BTN, 'text-danger hover:bg-danger/10')}
            title={t('action.delete')}
            aria-label={t('action.delete')}
            onClick={onDelete}
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
