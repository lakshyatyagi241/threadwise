'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { AiagAssistant } from '@crm/contracts';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, cn, useToast } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { deleteAssistant, duplicateAssistant, KEYS, useAssistants } from '../api/training';
import {
  accentFor,
  matchesSearch,
  matchesStatus,
  providerPill,
  relativeShort,
  stampShort,
  statCards,
  STATUS_FILTERS,
  STATUS_PILL,
  type StatusFilter,
} from '../lib/list-model';
import { AgentIcon, DuplicateIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';
import { PlanPaywall } from './plan-paywall';
import { ResponderCard } from './responder-card';

const reason = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const isPlanLocked = (e: unknown) => e instanceof ApiError && e.code === 'PLAN_FEATURE_LOCKED';

const KICKER = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const GRID =
  'grid grid-cols-[minmax(240px,1.6fr)_120px_120px_100px_130px_130px] min-w-[900px] items-center gap-3';
const ICON_BTN =
  'inline-flex size-7 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
const NEW_BTN =
  'inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90';

/**
 * `/ai-training` (WD-AIAG-001): the responder-mode card, the status views, four stat cards and the table of assistants with their
 * row actions. The status views and the search filter the rows that are loaded; the stat numbers are always workspace-wide.
 */
export function TrainingScreen() {
  const t = useTranslations('aiTraining.list');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const canCreate = useCan('aiag.training.create');
  const canUpdate = useCan('aiag.training.update');
  const canDelete = useCan('aiag.training.delete');

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const list = useAssistants();
  const [pendingDelete, setPendingDelete] = useState<AiagAssistant | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const first = list.data?.pages[0];
  const stats = useMemo(() => (first ? statCards(first.stats) : null), [first]);
  const all = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const rows = useMemo(
    () => all.filter((a) => matchesStatus(a, filter) && matchesSearch(a, q)),
    [all, filter, q],
  );

  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });

  const duplicate = async (a: AiagAssistant) => {
    setBusy(a.id);
    try {
      const copy = await duplicateAssistant(a.id);
      refresh();
      router.push(`/ai-training/${copy.id}/edit`);
    } catch (e) {
      toast(reason(e, t('duplicateFailed')), 'danger');
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(pendingDelete.id);
    try {
      await deleteAssistant(pendingDelete.id);
      toast(t('deleted'), 'success');
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast(t('deleteFailed', { reason: reason(e, t('networkError')) }), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const counts: Record<StatusFilter, number> = {
    all: stats?.all ?? 0,
    active: stats?.active ?? 0,
    paused: stats?.paused ?? 0,
  };
  const empty = !list.isPending && !list.isError && all.length === 0;

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      {isPlanLocked(list.error) && <PlanPaywall />}
      <ResponderCard />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-6">
          <div className="rounded-2xl border border-emerald-600/30 bg-emerald-50 p-3 text-xs leading-relaxed dark:bg-emerald-950/30">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <span className="size-2 rounded-full bg-emerald-600" aria-hidden="true" />
              {t('tip')}
            </div>
            {t.rich('tipBody', {
              link: (chunks) => (
                <Link href="/chatbot-widgets" className="font-semibold text-brand underline">
                  {chunks}
                </Link>
              ),
            })}
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
                  aria-pressed={active}
                  onClick={() => setFilter(key)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
              {t('knowledgeTip')}
            </div>
            {t('knowledgeTipBody')}
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
                <Link href="/ai-training/create" className={NEW_BTN}>
                  <PlusIcon className="size-3.5" />
                  {t('newAgent')}
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('card.total')} value={String(stats?.all ?? '—')}>
              {t('card.activeHint', { count: stats?.active ?? 0 })}
            </StatCard>
            <StatCard
              label={t('card.knowledge')}
              value={stats ? stats.sources.toLocaleString() : '—'}
            >
              {t('card.indexedHint', { count: stats?.ready ?? 0 })}
            </StatCard>
            <StatCard label={t('card.avg')} value={stats?.avgPerAgent ?? '—'}>
              {t('card.entriesUnit')}
            </StatCard>
            <StatCard
              label={t('card.health')}
              aside={stats ? `${stats.healthPct}%` : undefined}
              value={stats ? t(`health.${stats.health}`) : '—'}
            />
          </div>

          <div className="overflow-hidden rounded-[14px] border border-border bg-background shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div
                role="group"
                aria-label={t('statusViews')}
                className="flex items-center gap-1 rounded-full bg-muted p-1"
              >
                {STATUS_FILTERS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      filter === key
                        ? 'bg-brand text-brand-foreground'
                        : 'text-muted-foreground hover:bg-border/50',
                    )}
                  >
                    {t(`status.${key}`)}{' '}
                    <span className="ms-1 font-mono text-[10px] opacity-80">{counts[key]}</span>
                  </button>
                ))}
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
                <div>{t('col.agent')}</div>
                <div>{t('col.provider')}</div>
                <div>{t('col.knowledge')}</div>
                <div>{t('col.tone')}</div>
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
                    message={isPlanLocked(list.error) ? '' : reason(list.error, '')}
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
                  <p className="mx-auto mb-4 max-w-md text-sm text-muted-foreground">
                    {t('emptyBody')}
                  </p>
                  {canCreate && (
                    <Link href="/ai-training/create" className={NEW_BTN}>
                      <PlusIcon className="size-3.5" />
                      {t('buildAgent')}
                    </Link>
                  )}
                </div>
              ) : rows.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {t('noMatch')}
                </p>
              ) : (
                rows.map((a) => (
                  <AgentRow
                    key={a.id}
                    a={a}
                    busy={busy === a.id}
                    canCreate={canCreate}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onDuplicate={() => void duplicate(a)}
                    onDelete={() => setPendingDelete(a)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <div>
                {t('showing')} <span className="font-mono text-foreground">{all.length}</span>{' '}
                {t('of')}{' '}
                <span className="font-mono text-foreground">
                  {(stats?.all ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="font-mono text-[10.5px]">
                {t('workspace')} · {t('agentsCount', { count: stats?.all ?? 0 })}
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

function AgentRow({
  a,
  busy,
  canCreate,
  canUpdate,
  canDelete,
  onDuplicate,
  onDelete,
}: {
  a: AiagAssistant;
  busy: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('aiTraining.list');
  const pill = STATUS_PILL[a.status];
  const prov = providerPill(a.aiProvider);
  return (
    <div className={cn(GRID, 'border-b border-border px-4 py-3 last:border-0 hover:bg-muted/40')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', accentFor(a.id))}>
          <AgentIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {canUpdate ? (
              <Link
                href={`/ai-training/${a.id}/edit`}
                className="truncate text-[12.5px] font-semibold hover:text-brand"
              >
                {a.name}
              </Link>
            ) : (
              <span className="truncate text-[12.5px] font-semibold">{a.name}</span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em]',
                pill.box,
              )}
            >
              <span className={cn('size-1.5 rounded-full', pill.dot)} aria-hidden="true" />
              {t(`status.${a.status}`)}
            </span>
          </div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            /{a.slug} · {a.aiModel}
          </div>
        </div>
      </div>
      <div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px]',
            prov.box,
          )}
        >
          <span className={cn('size-1.5 rounded-full', prov.dot)} aria-hidden="true" />
          {a.aiProvider}
        </span>
      </div>
      <div
        className={cn(
          'font-mono text-[11.5px]',
          a.sourceCount > 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {a.sourceCount > 0 ? t('entries', { count: a.sourceCount }) : '—'}
      </div>
      <div className="text-xs capitalize">{a.tone}</div>
      <div className="min-w-0">
        <div className="truncate font-mono text-[11.5px]">{relativeShort(a.updatedAt)}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {stampShort(a.updatedAt)}
        </div>
      </div>
      <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
        {canUpdate && (
          <Link
            href={`/ai-training/${a.id}/edit`}
            className={cn(ICON_BTN, 'text-brand')}
            title={t('edit')}
            aria-label={t('editNamed', { name: a.name })}
          >
            <EditIcon className="size-3.5" />
          </Link>
        )}
        {canCreate && (
          <button
            type="button"
            disabled={busy}
            onClick={onDuplicate}
            className={ICON_BTN}
            title={t('duplicate')}
            aria-label={t('duplicateNamed', { name: a.name })}
          >
            <DuplicateIcon className="size-3.5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className={cn(ICON_BTN, 'text-danger')}
            title={t('deleteAgent')}
            aria-label={t('deleteNamed', { name: a.name })}
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
