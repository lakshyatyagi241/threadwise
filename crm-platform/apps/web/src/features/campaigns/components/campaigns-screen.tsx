'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, StatTile, cn, useToast } from '@crm/ui';
import type { Campaign } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { pageWindow } from '@/features/broadcasts/components/broadcasts-pagination';
import { NewCampaignButton } from './new-campaign-button';
import {
  bulkDeleteCampaigns,
  cancelCampaign,
  deleteCampaign,
  download,
  KEYS,
  resendCampaign,
  resumeCampaign,
  useCampaignList,
} from '../api/campaigns';
import { can, pageCount, parseState, stateToSearch, type ListState } from '../lib/list-model';
import { EarlierLink } from '../history/components/parts';
import { CampaignCard } from './campaign-card';
import { CampaignTable } from './campaign-table';
import { CampaignsRail } from './campaigns-rail';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, SearchIcon, TrashIcon } from './icons';

type View = 'list' | 'blocks';
const VIEW_KEY = 'campaigns.list.view';

const ListViewIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const BlockViewIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const RANGES = ['all', '7d', '30d', '90d'] as const;
const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString());
/** A share of `of` as a percentage with one decimal (0 when there is nothing to divide by). */
const rate = (part: number | undefined, of: number | undefined) =>
  of && part ? ((part / of) * 100).toFixed(1) : '0';

type Pending =
  | { kind: 'delete'; c: Campaign }
  | { kind: 'resend'; c: Campaign }
  | { kind: 'bulk'; ids: string[] }
  | null;

/**
 * `/campaigns` (TW-CAMP-001): the status and type views, six tiles, and the campaign cards with their actions. The filters and
 * the page live in the address; the numbers follow the worker every 15 seconds.
 */
export function CampaignsScreen() {
  const t = useTranslations('campaigns.list');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const canCreate = useCan('camp.campaigns.create');
  const canUpdate = useCan('camp.campaigns.update');
  const canControl = useCan('camp.campaigns.control');
  const canDelete = useCan('camp.campaigns.delete');
  const canExport = useCan('camp.campaigns.export');

  const state = useMemo(() => parseState(new URLSearchParams(search.toString())), [search]);
  const go = (patch: Partial<ListState>) =>
    router.replace(`${pathname}${stateToSearch({ ...state, page: 1, ...patch })}`, {
      scroll: false,
    });

  // Search applies 220 ms after typing stops (Reference's rhythm), without a reload.
  const [q, setQ] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    setSeenQ(state.q);
    setQ(state.q);
  }
  useEffect(() => {
    if (q.trim() === state.q) return;
    const id = window.setTimeout(() => go({ q: q.trim() }), 220);
    return () => window.clearTimeout(id);
    // `go` closes over the current state; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useCampaignList(state);
  const data = list.data;
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The list or block choice is kept in this browser; it is read after mount so the server and first paint agree.
  const [view, setViewState] = useState<View>('list');
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after mount so the server and first paint agree
      if (localStorage.getItem(VIEW_KEY) === 'blocks') setViewState('blocks');
    } catch {
      /* storage can be blocked */
    }
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage can be blocked */
    }
  };

  const refresh = () => void qc.invalidateQueries({ queryKey: KEYS.all });
  const run = async (id: string, action: () => Promise<unknown>, ok: string | (() => string)) => {
    setBusy(id);
    try {
      await action();
      toast(typeof ok === 'function' ? ok() : ok, 'success');
    } catch (e) {
      toast(message(e, t('failed')), 'danger');
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const exportRows = async (c: Campaign) => {
    try {
      const { blob, filename } = await download(`/campaigns/${c.id}/export`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(message(e, t('exportFailed')), 'danger');
    }
  };

  const confirm = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === 'delete') await run(p.c.id, () => deleteCampaign(p.c.id), t('deleted'));
    else if (p.kind === 'resend') {
      let sent = 0;
      await run(
        p.c.id,
        async () => {
          sent = (await resendCampaign(p.c.id, { scope: 'all', contactIds: [] })).recipients;
        },
        () => t('resent', { count: sent }),
      );
    } else {
      let gone = 0;
      await run(
        'bulk',
        async () => {
          gone = (await bulkDeleteCampaigns(p.ids)).ids.length;
          setPicked([]);
        },
        () => t('bulkDeleted', { count: gone }),
      );
    }
  };

  const items = data?.data ?? [];
  const total = data?.page.total ?? 0;
  const pages = pageCount(total, data?.page.perPage ?? 12);
  const deletable = items.filter((c) => can.delete(c.status));
  const allShown = deletable.length > 0 && deletable.every((c) => picked.includes(c.id));
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? 'border-brand bg-brand text-brand-foreground' : 'border-border bg-background hover:bg-muted'}`;

  return (
    <div className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <CampaignsRail
          list={data}
          status={state.status}
          type={state.type}
          canCreate={canCreate}
          onStatus={(status) => go({ status })}
          onType={(type) => go({ type })}
        />

        <section className="min-w-0">
          <div
            data-testid="campaigns-sticky-header"
            className="sticky top-14 z-20 -mx-2 mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-border/60 bg-background/95 px-2 pb-3 pt-2 backdrop-blur"
          >
            {/* The heading block is Inter, weight 600, like the operator dashboard's. */}
            <div className="font-[family-name:var(--font-inter)] font-semibold">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('workspace')} · {session.org.name}
              </div>
              <h1 className="text-[32px] leading-none tracking-tight">
                {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
              </h1>
              <p className="mt-1 hidden max-w-xl text-sm font-semibold text-muted-foreground xl:block">
                {t('intro')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" className="rounded-full" onClick={refresh}>
                <RefreshIcon className="size-3.5" />
                {t('refresh')}
              </Button>
              <EarlierLink />
              {canCreate && <NewCampaignButton label={t('newCampaign')} />}
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label={t('tile.sent')}
              value={n(data?.stats.sentTotal)}
              hint={t('tile.campaigns', { count: n(data?.stats.total) })}
            />
            <StatTile
              label={t('tile.delivered')}
              value={n(data?.stats.deliveredTotal)}
              hint={t('tile.deliveredRate', {
                rate: rate(data?.stats.deliveredTotal, data?.stats.sentTotal),
              })}
              tone="accent"
            />
            <StatTile
              label={t('tile.read')}
              value={n(data?.stats.readTotal)}
              hint={t('tile.readRate', {
                rate: rate(data?.stats.readTotal, data?.stats.deliveredTotal),
              })}
            />
            <StatTile
              label={t('tile.failed')}
              value={n(data?.stats.failedTotal)}
              hint={t('tile.failedCampaigns', { count: n(data?.stats.failed) })}
            />
            <StatTile
              label={t('tile.processing')}
              value={n(data?.stats.processing)}
              hint={t('tile.queued', { count: n(data?.stats.queued) })}
              tone="warning"
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={pill(state.range === r)}
                  onClick={() => go({ range: r })}
                >
                  {t(`range.${r}`)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label={t('view.label')}
                className="flex overflow-hidden rounded-md border border-border"
              >
                {(['list', 'blocks'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`campaigns-view-${v}`}
                    aria-pressed={view === v}
                    title={t(`view.${v}`)}
                    aria-label={t(`view.${v}`)}
                    onClick={() => setView(v)}
                    className={cn(
                      'grid size-9 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      view === v
                        ? 'bg-brand text-brand-foreground'
                        : 'bg-background hover:bg-muted',
                    )}
                  >
                    {v === 'list' ? <ListViewIcon /> : <BlockViewIcon />}
                  </button>
                ))}
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-9 w-64 ps-9 text-xs"
                />
              </div>
            </div>
          </div>

          {canDelete && (deletable.length > 0 || picked.length > 0) && (
            <div className="mb-3 flex items-center justify-between gap-3 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-6 accent-[var(--primary)]"
                  checked={allShown}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...new Set([...picked, ...deletable.map((c) => c.id)])]
                        : picked.filter((id) => !deletable.some((c) => c.id === id)),
                    )
                  }
                />
                {t('selectPage')}
              </label>
              {picked.length > 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setPending({ kind: 'bulk', ids: picked })}
                >
                  <TrashIcon className="size-3.5" />
                  {t('deleteSelected', { count: picked.length })}
                </Button>
              )}
            </div>
          )}

          {list.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : list.isError ? (
            <EmptyState title={t('loadError')} />
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
              <h2 className="text-2xl">{t('noData')}</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                {t('noDataHint')}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => router.replace(pathname)}
                >
                  {t('reset')}
                </Button>
                {canCreate && <NewCampaignButton label={t('createCampaign')} />}
              </div>
            </div>
          ) : view === 'list' ? (
            <CampaignTable
              items={items}
              picked={picked}
              busy={busy}
              canControl={canControl}
              canUpdate={canUpdate}
              canDelete={canDelete}
              canExport={canExport}
              onSelect={(c, on) =>
                setPicked(on ? [...picked, c.id] : picked.filter((id) => id !== c.id))
              }
              onSelectAll={(on) =>
                setPicked(
                  on
                    ? [...new Set([...picked, ...deletable.map((c) => c.id)])]
                    : picked.filter((id) => !deletable.some((c) => c.id === id)),
                )
              }
              onCancel={(c) => void run(c.id, () => cancelCampaign(c.id), t('cancelled'))}
              onResume={(c) => void run(c.id, () => resumeCampaign(c.id), t('resumed'))}
              onResend={(c) => setPending({ kind: 'resend', c })}
              onDelete={(c) => setPending({ kind: 'delete', c })}
              onExport={(c) => void exportRows(c)}
            />
          ) : (
            <div className="space-y-3">
              {items.map((c) => (
                <CampaignCard
                  key={c.id}
                  c={c}
                  selected={picked.includes(c.id)}
                  busy={busy === c.id || busy === 'bulk'}
                  canControl={canControl}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  canExport={canExport}
                  onSelect={(on) =>
                    setPicked(on ? [...picked, c.id] : picked.filter((id) => id !== c.id))
                  }
                  onCancel={() => void run(c.id, () => cancelCampaign(c.id), t('cancelled'))}
                  onResume={() => void run(c.id, () => resumeCampaign(c.id), t('resumed'))}
                  onResend={() => setPending({ kind: 'resend', c })}
                  onDelete={() => setPending({ kind: 'delete', c })}
                  onExport={() => void exportRows(c)}
                />
              ))}
            </div>
          )}

          {total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t('showing', { shown: items.length, total })}</span>
              {total > 0 && (
                <nav className="flex items-center gap-1" aria-label={t('pages')}>
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
                    disabled={state.page <= 1}
                    onClick={() =>
                      router.replace(
                        `${pathname}${stateToSearch({ ...state, page: state.page - 1 })}`,
                      )
                    }
                    aria-label={t('prev')}
                  >
                    <ChevronLeftIcon className="size-4" />
                  </button>
                  {pageWindow(state.page, pages).map((p, i) =>
                    p === 'gap' ? (
                      <span key={`g${i}`} className="px-1">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        aria-current={p === state.page ? 'page' : undefined}
                        className={`grid size-9 place-items-center rounded-md border text-sm tabular-nums ${p === state.page ? 'border-brand bg-brand text-brand-foreground' : 'border-border hover:bg-muted'}`}
                        onClick={() =>
                          router.replace(`${pathname}${stateToSearch({ ...state, page: p })}`)
                        }
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    className="grid size-9 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
                    disabled={state.page >= pages}
                    onClick={() =>
                      router.replace(
                        `${pathname}${stateToSearch({ ...state, page: state.page + 1 })}`,
                      )
                    }
                    aria-label={t('next')}
                  >
                    <ChevronRightIcon className="size-4" />
                  </button>
                </nav>
              )}
            </div>
          )}
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('help.label', { n: String(i + 1).padStart(2, '0') })}
                </div>
                <h2 className="mt-2 text-lg leading-snug">{t(`help.items.${i}.title`)}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {t(`help.items.${i}.body`)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        tone="danger"
        busy={busy !== null}
        title={pending?.kind === 'resend' ? t('resendTitle') : t('deleteTitle')}
        message={
          pending?.kind === 'resend'
            ? t('resendConfirm')
            : pending?.kind === 'bulk'
              ? t('bulkConfirm', { count: pending.ids.length })
              : t('deleteConfirm')
        }
        confirmLabel={pending?.kind === 'resend' ? t('resend') : t('delete')}
        cancelLabel={t('cancel')}
        onClose={() => setPending(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
