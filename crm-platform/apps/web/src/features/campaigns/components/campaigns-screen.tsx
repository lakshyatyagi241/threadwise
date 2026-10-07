'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Input, Spinner, StatTile, useToast } from '@crm/ui';
import type { Campaign } from '@crm/contracts';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { pageWindow } from '@/features/broadcasts/components/broadcasts-pagination';
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
import { pageCount, parseState, stateToSearch, type ListState } from '../lib/list-model';
import { CampaignCard } from './campaign-card';
import { CampaignsRail } from './campaigns-rail';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from './icons';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const RANGES = ['all', '7d', '30d', '90d'] as const;
const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString());

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
  const filtered =
    state.status !== 'all' || state.type !== 'all' || state.range !== 'all' || state.q !== '';
  const allShown = items.length > 0 && items.every((c) => picked.includes(c.id));
  const pill = (active: boolean) =>
    `rounded-full border px-3 py-1 text-[11.5px] transition ${active ? 'border-brand bg-brand text-brand-foreground' : 'border-border bg-background hover:bg-muted'}`;

  return (
    <main className="mx-auto max-w-none px-4 py-7 sm:px-6 lg:px-7">
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
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('workspace')} · {session.org.name}
              </div>
              <h1 className="text-3xl font-normal leading-none tracking-tight lg:text-[44px]">
                {t('title')} <span className="italic text-brand">{t('titleAccent')}</span>
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" className="rounded-full" onClick={refresh}>
                <RefreshIcon className="size-3.5" />
                {t('refresh')}
              </Button>
              {canCreate && (
                <Link
                  href="/campaigns/wizard"
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-brand bg-background px-4 text-xs font-semibold text-brand hover:bg-brand/10"
                >
                  <PlusIcon className="size-3.5" />
                  {t('createBroadcast')}
                </Link>
              )}
              {canCreate && (
                <Link
                  href="/campaigns/create"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground hover:opacity-90"
                >
                  <PlusIcon className="size-3.5" />
                  {t('newCampaign')}
                </Link>
              )}
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-3 lg:grid-cols-6">
            <StatTile
              label={t('tile.sent')}
              value={n(data?.stats.sentTotal)}
              hint={t('tile.campaigns', { count: n(data?.stats.total) })}
              tone="accent"
            />
            <StatTile
              label={t('tile.delivered')}
              value={n(data?.stats.deliveredTotal)}
              tone="accent"
            />
            <StatTile label={t('tile.read')} value={n(data?.stats.readTotal)} />
            <StatTile label={t('tile.failed')} value={n(data?.stats.failedTotal)} />
            <StatTile
              label={t('tile.processing')}
              value={n(data?.stats.processing)}
              hint={t('tile.inFlight')}
              tone="warning"
            />
            <StatTile
              label={t('tile.queued')}
              value={n(data?.stats.queued)}
              hint={t('tile.awaiting')}
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

          {canDelete && items.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 text-xs">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={allShown}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...new Set([...picked, ...items.map((c) => c.id)])]
                        : picked.filter((id) => !items.some((c) => c.id === id)),
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
            <EmptyState
              title={filtered ? t('noMatch') : t('empty')}
              message={filtered ? t('noMatchHint') : t('emptyHint')}
              actions={
                filtered ? (
                  <Button variant="secondary" onClick={() => router.replace(pathname)}>
                    {t('reset')}
                  </Button>
                ) : (
                  canCreate && (
                    <Link
                      href="/campaigns/create"
                      className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-xs font-semibold text-brand-foreground"
                    >
                      {t('newCampaign')}
                    </Link>
                  )
                )
              }
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
              {pages > 1 && (
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
    </main>
  );
}
