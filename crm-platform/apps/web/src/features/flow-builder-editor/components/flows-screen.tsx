'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FLOW_LIBRARY_CATEGORIES,
  FLOW_IMPORT_MAX_BYTES,
  flbExportFileName,
  type FlowFeatured,
  type FlowSummary,
  type FlowTemplateCard,
} from '@crm/contracts';
import { ConfirmDialog, Modal, useToast, Button } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import { flowsApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';
import { useFlowsOverview, useFlowsPage } from '../api/list';
import { newHref, openHref, type BuilderMode } from '../lib/builder-mode';
import { isWaboExport, waboToGraph } from '../lib/wabo-import';
import {
  PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  lastPage,
  pageItems,
  parseState,
  toSearch,
  type ListState,
} from '../lib/list-model';
import '../builder/builder.css';
import { FeaturedCard, FlowCard, type CardActions } from './flow-card';

const LIB_ICON: Record<string, string> = {
  all: 'M3 4h10M3 8h10M3 12h6',
  cart: 'M3 5h8l1 6H4z',
  welcome: 'M3 11s2-1 5-1 5 1 5 1M5 6.5h.01M11 6.5h.01M8 9.5s1 .8 0 1.5',
  'post-purchase': 'M4 13V7l4-4 4 4v6M3 13h10',
  're-engagement': 'M11 4H5a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H5M5 4l-2 2 2 2M11 16l2-2-2-2',
  event: 'M2 3h12v11H2zM2 6h12M5 1v3M11 1v3',
  lead: 'M5 6a3 3 0 1 0 0-0.01M2 14c0-3 3-4 6-4s6 1 6 4',
};
/** The upload types WaDesk accepts for an import (`mimetypes:application/json,text/plain,text/json`). */
const IMPORT_MIME_TYPES = ['application/json', 'text/plain', 'text/json'];
const STATUS_DOT = { live: 'bg-primary', paused: 'bg-[#5B3D8A]', draft: 'bg-border' } as const;

const Svg = ({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

/** Carried to the builder the way WaDesk's flash message is: shown once as a toast when it opens. */
export const FLASH_KEY = 'flb:flash';
const flash = (m: string) => {
  try {
    sessionStorage.setItem(FLASH_KEY, m);
  } catch {
    /* private mode: the toast is a convenience */
  }
};

/** `/flows` (WD-FLB-001..013): the library and status rails, KPI tiles, tabs and search, the featured card, the template gallery, the grid and its actions. */
export function FlowsScreen() {
  const t = useTranslations('flb.list');
  const tc = useTranslations('flb.common');
  const tt = useTranslations('flb.toast');
  const td = useTranslations('flb.delete');
  const tr = useTranslations('flb.rename');
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = useSearchParams();
  const state = parseState(params);
  const orgName = useSession().org.name;
  const canRead = useCan('flb.flows.read');
  const canCreate = useCan('flb.flows.create');
  const canUpdate = useCan('flb.flows.update');
  const canDelete = useCan('flb.flows.delete');

  // WaDesk sends an agent or viewer who opens /flows to their home, the team inbox, instead of showing an empty page.
  useEffect(() => {
    if (!canRead) router.replace('/inbox');
  }, [canRead, router]);

  const list = useFlowsPage(state);
  const overview = useFlowsOverview();
  const builderMode: BuilderMode = overview.data?.builderMode ?? 'advanced';
  const counts = overview.data?.statusCounts ?? { all: 0, live: 0, paused: 0, draft: 0 };
  const cats = overview.data?.categoryCounts ?? { all: 0 };

  const [draft, setDraft] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<FlowSummary | null>(null);
  const [deleting, setDeleting] = useState<FlowSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const duplicating = useRef(new Set<string>());

  const go = useCallback(
    (next: Partial<ListState>) =>
      router.push(`/flows${toSearch({ ...state, page: 1, ...next })}`, { scroll: false }),
    [router, state],
  );
  // The search box shows the address's `q` (so back / forward follow it) until the person types; it then navigates 220 ms
  // after typing stops and goes back to following the address.
  const search = draft ?? state.q;
  useEffect(() => {
    if (draft === null) return;
    const h = setTimeout(() => {
      go({ q: draft });
      setDraft(null);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [draft, go]);

  const refresh = () => qc.invalidateQueries({ queryKey: FLB_KEYS.all });
  const reason = (e: unknown) =>
    e instanceof ApiError ? e.message : String((e as Error)?.message ?? e);
  // WaDesk words a failed row action "Action failed: ..." and a failed list refetch "Could not refresh: ...".
  const fail = (e: unknown) => toast(t('actionFailed', { message: reason(e) }), 'danger');

  const actions: CardActions = {
    can: { update: canUpdate, create: canCreate, remove: canDelete },
    builderMode,
    onToggle: async (f) => {
      try {
        const r = await flowsApi.toggle(f.id);
        toast(r.isActive ? tt('resumed') : tt('paused'), 'success');
        await refresh();
      } catch (e) {
        fail(e);
      }
    },
    onRename: setRenaming,
    onDuplicate: async (f: FlowSummary | FlowFeatured) => {
      // a second click while the first copy is being made would make a second copy (the browser form post of WaDesk leaves the page)
      if (duplicating.current.has(f.id)) return;
      duplicating.current.add(f.id);
      try {
        const copy = await flowsApi.duplicate(f.id);
        flash(tt('duplicated'));
        router.push(openHref(builderMode, copy.id, copy.flowType));
      } catch (e) {
        duplicating.current.delete(f.id);
        fail(e);
      }
    },
    onExport: async (f) => {
      try {
        const file = await flowsApi.exportFlow(f.id);
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = flbExportFileName(f.name, f.id);
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        fail(e);
      }
    },
    onDelete: setDeleting,
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await flowsApi.remove(deleting.id);
      toast(td('toast'), 'success');
      setDeleting(null);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    // The same checks, in the same order and words, as WaDesk's upload validation (`file|max:4096|mimetypes:...`).
    if (file.size > FLOW_IMPORT_MAX_BYTES) return finishImport(t('importFileTooLarge'));
    if (file.size === 0 || (file.type && !IMPORT_MIME_TYPES.includes(file.type)))
      return finishImport(t('importWrongType'));
    let payload: unknown;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      payload = null;
    }
    // A flow exported from the wabo console (the bot builder's records) is converted here into this app's export file.
    if (isWaboExport(payload)) {
      const w = waboToGraph(payload);
      payload = {
        _wadesk_flow_export: 1,
        exported_at: new Date().toISOString(),
        name: file.name.replace(/\.json$/i, '').slice(0, 120) || 'Imported flow',
        flow_type: 'chat',
        category: null,
        flow_data: w.graph,
      };
    }
    try {
      // Not JSON / not an object: let the server answer, so the "not a valid <brand> flow export" wording is the one source.
      const created = await flowsApi.importFlow(
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
      );
      flash(tt('imported'));
      router.push(openHref(builderMode, created.id, created.flowType));
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : t('importFailed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const finishImport = (message: string) => {
    setImportError(message);
    if (fileRef.current) fileRef.current.value = '';
  };

  const cloneTemplate = async (tpl: FlowTemplateCard) => {
    try {
      const created = await flowsApi.cloneTemplate(tpl.id);
      flash(tt('cloned', { name: tpl.name }));
      router.push(`/flows/builder/${created.id}`);
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Could not clone the template.');
    }
  };

  const total = list.total ?? 0;
  const last = lastPage(total);
  const page = Math.min(list.page, last);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, (page - 1) * PAGE_SIZE + list.items.length);

  const railBtn = (active: boolean) =>
    `flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px] ${active ? 'bg-brand font-medium text-brand-foreground' : 'text-foreground/80 hover:bg-muted'}`;

  if (!canRead) return null;

  return (
    <div className="flb-root mx-auto max-w-none" data-testid="flows-screen">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3 self-start lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border bg-[var(--flb-bubble)]/40 p-3 text-[11px] leading-relaxed text-foreground/80">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <svg viewBox="0 0 16 16" className="h-3 w-3 text-brand" fill="currentColor">
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('tipTitle')}
            </div>
            {t('railTip')}
          </div>

          <div className="rounded-2xl border border-border bg-background p-2 shadow-sm">
            <div className="px-3 pt-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('library')}
            </div>
            {[{ key: 'all' }, ...FLOW_LIBRARY_CATEGORIES].map((c) => {
              const active = state.category === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => go({ category: c.key })}
                  className={railBtn(active)}
                  data-filter="category"
                  data-value={c.key}
                >
                  <span className="flex items-center gap-2">
                    <Svg d={LIB_ICON[c.key] ?? LIB_ICON.all!} />
                    {c.key === 'all'
                      ? t('libraryAll')
                      : t(`library_cat.${c.key}` as 'library_cat.cart')}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${active ? 'opacity-90' : 'text-muted-foreground'}`}
                  >
                    {cats[c.key] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-background p-2 shadow-sm">
            <div className="px-3 pt-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('status')}
            </div>
            {(['live', 'paused', 'draft'] as const).map((k) => {
              const active = state.status === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => go({ status: k })}
                  className={railBtn(active)}
                  data-filter="status"
                  data-value={k}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[k]}`} />
                    {t(`state.${k}`)}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${active ? 'opacity-90' : 'text-muted-foreground'}`}
                  >
                    {counts[k]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-[var(--flb-bubble)]/40 p-3 text-[11px] leading-relaxed text-foreground/80">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <svg viewBox="0 0 16 16" className="h-3 w-3 text-brand" fill="currentColor">
                <circle cx="8" cy="8" r="6" />
              </svg>
              {t('tipTitle')}
            </div>
            {t('tip')}
          </div>
        </aside>

        {/* a div: the app shell already provides the page's one main landmark (a second one fails WCAG landmark rules) */}
        <div>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {t('workspace')} · {orgName}
              </div>
              <h1 className="font-serif text-[32px] leading-[1.05] font-normal tracking-tight sm:text-[38px] lg:text-[44px]">
                {t('title')} <span className="text-brand italic">{t('titleAccent')}</span>.
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">{t('subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canUpdate && overview.data ? (
                <BuilderPicker
                  platform={overview.data.platformBuilderMode}
                  own={overview.data.workspaceBuilderMode}
                  onChange={async (mode) => {
                    try {
                      const next = await flowsApi.setBuilderMode({ mode });
                      toast(
                        t('builder.saved', { mode: t(`builder.${next.builderMode}`) }),
                        'success',
                      );
                      await refresh();
                    } catch (e) {
                      fail(e);
                    }
                  }}
                />
              ) : null}
              <Link
                href="/flow-runtime/analytics"
                title={t('analyticsTitle')}
                className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
              >
                <Svg
                  d="M2 13V3M2 13h12M5 11V8M8 11V5M11 11V9.5"
                  className="h-3.5 w-3.5 text-brand"
                />
                {t('analytics')}
              </Link>
              {canCreate && builderMode !== 'simple' ? (
                <button
                  type="button"
                  onClick={() => router.push('/flows/builder?ai=1')}
                  className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brand" fill="currentColor">
                    <path d="M8 1l1.5 4L14 6.5 9.5 8 8 12 6.5 8 2 6.5 6.5 5z" />
                  </svg>
                  {t('useAi')}
                </button>
              ) : null}
              {canCreate ? (
                <button
                  type="button"
                  data-flow-create
                  onClick={() =>
                    builderMode === 'simple'
                      ? router.push(newHref(builderMode))
                      : setCreateOpen(true)
                  }
                  className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground hover:opacity-90"
                >
                  <Svg d="M8 3v10M3 8h10" />
                  {t('create')}
                </button>
              ) : null}
              {canCreate ? (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted"
                  title={t('importTitle')}
                >
                  <Svg
                    d="M8 2v7M5 6l3 3 3-3M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11"
                    className="h-3.5 w-3.5 text-brand"
                  />
                  {t('import')}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => void onImport(e.target.files?.[0])}
                  />
                </label>
              ) : null}
            </div>
          </div>

          {importError ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-[var(--flb-coral)]/40 bg-[var(--flb-coral)]/10 px-4 py-2.5 text-[12px] text-[#A1431F]"
            >
              {importError}
            </div>
          ) : null}

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                k: 'live',
                label: t('stats.active'),
                note: t('stats.activeNote'),
                val: counts.live,
                border: 'border-primary/40',
                noteCls: 'text-brand',
              },
              {
                k: 'all',
                label: t('stats.total'),
                note: t('stats.totalNote'),
                val: counts.all,
                border: 'border-border',
                noteCls: 'text-brand',
              },
              {
                k: 'draft',
                label: t('stats.drafts'),
                note: t('stats.draftsNote'),
                val: counts.draft,
                border: 'border-border',
                noteCls: 'text-muted-foreground',
              },
              {
                k: 'paused',
                label: t('stats.paused'),
                note: t('stats.pausedNote'),
                val: counts.paused,
                border: 'border-amber-400/40',
                noteCls: 'text-muted-foreground',
              },
            ].map((s) => (
              <div
                key={s.k}
                className={`rounded-2xl border bg-background p-4 shadow-sm ${s.border}`}
              >
                <div className="text-[11px] font-medium text-foreground/70">{s.label}</div>
                <div className="mt-1 font-serif text-[34px] leading-none" data-stat={s.k}>
                  {s.val}
                </div>
                <div className={`mt-2 text-[11px] ${s.noteCls}`}>{s.note}</div>
              </div>
            ))}
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-2">
            {(['all', 'live', 'paused', 'draft'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => go({ status: k })}
                data-tab={k}
                className={`inline-flex items-center gap-2 border-b-2 py-3.5 text-[14px] whitespace-nowrap transition ${state.status === k ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {t(`tabs.${k}`)}
                <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-foreground/70">
                  {counts[k]}
                </span>
              </button>
            ))}
            <div className="flex-1" />
            <div className="relative w-full sm:w-auto">
              <svg
                viewBox="0 0 16 16"
                className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="7" cy="7" r="5" />
                <path d="m11 11 3 3" />
              </svg>
              <input
                type="search"
                value={search}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchLabel')}
                className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-9 text-[12px] outline-none focus:border-brand sm:w-64"
              />
            </div>
          </div>

          {overview.data?.featured ? (
            <FeaturedCard flow={overview.data.featured} actions={actions} />
          ) : null}

          {overview.data && overview.data.templates.length > 0 && canCreate ? (
            <TemplateGallery templates={overview.data.templates} onUse={cloneTemplate} />
          ) : null}

          <div
            className={
              list.isFetching && !list.isPending
                ? 'opacity-60 transition-opacity'
                : 'transition-opacity'
            }
            aria-busy={list.isFetching}
          >
            {list.isError ? (
              <div className="rounded-2xl border border-border p-6 text-center text-[13px]">
                {t('loadFailed')}{' '}
                <button type="button" className="underline" onClick={() => void list.refetch()}>
                  {t('retry')}
                </button>
              </div>
            ) : list.isPending ? (
              <div className="py-10 text-center text-[13px] text-muted-foreground">
                {tc('loading')}
              </div>
            ) : list.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-background px-6 py-12 text-center">
                <div className="font-serif text-[24px]">{t('emptyTitle')}</div>
                <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
                  {t('empty')}
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push('/flows')}
                    className="rounded-full border border-border px-4 py-2 text-[12px] font-medium hover:bg-muted"
                  >
                    {t('reset')}
                  </button>
                  {canCreate ? (
                    <Link
                      href={newHref(builderMode)}
                      className="rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-brand-foreground"
                    >
                      {t('create')}
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" id="fl-grid">
                {list.items.map((f) => (
                  <FlowCard key={f.id} flow={f} actions={actions} />
                ))}
              </div>
            )}
          </div>

          {total > 0 ? (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-[12px] shadow-sm"
              aria-label={t('pager.label')}
            >
              <div className="font-mono text-[11px] text-muted-foreground">
                {t('pager.showing', {
                  from: from.toLocaleString('en-US'),
                  to: to.toLocaleString('en-US'),
                  total: total.toLocaleString('en-US'),
                })}
              </div>
              {last > 1 ? (
                <div className="flex items-center gap-1">
                  {page <= 1 ? (
                    <span className="cursor-not-allowed rounded-full border border-border px-3 py-1.5 text-muted-foreground/60">
                      {t('pager.prev')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => go({ page: page - 1 })}
                      className="rounded-full border border-border bg-background px-3 py-1.5 hover:bg-muted"
                    >
                      {t('pager.prev')}
                    </button>
                  )}
                  {pageItems(page, last).map((p, i) =>
                    typeof p === 'string' ? (
                      <span key={`${p}${i}`} className="px-2 py-1.5 text-muted-foreground/60">
                        ...
                      </span>
                    ) : p === page ? (
                      <span
                        key={p}
                        aria-current="page"
                        className="min-w-8 rounded-full bg-brand px-3 py-1.5 text-center font-semibold text-brand-foreground"
                      >
                        {p}
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => go({ page: p })}
                        className="min-w-8 rounded-full border border-border bg-background px-3 py-1.5 text-center hover:bg-muted"
                      >
                        {p}
                      </button>
                    ),
                  )}
                  {page >= last ? (
                    <span className="cursor-not-allowed rounded-full border border-border px-3 py-1.5 text-muted-foreground/60">
                      {t('pager.next')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => go({ page: page + 1 })}
                      className="rounded-full border border-border bg-background px-3 py-1.5 hover:bg-muted"
                    >
                      {t('pager.next')}
                    </button>
                  )}
                </div>
              ) : null}
            </nav>
          ) : null}

          <div className="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="rounded-2xl border border-border bg-background p-5 shadow-sm">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('help.label', { n: `0${n}` })}
                </div>
                <div className="mb-1 font-serif text-[20px] font-normal tracking-[-0.01em]">
                  {t(`help.q${n}` as 'help.q1')}
                </div>
                <p className="text-[12.5px] leading-relaxed text-foreground/70">
                  {t(`help.a${n}` as 'help.a1')}
                </p>
              </div>
            ))}
          </div>

          {total > 0 ? (
            <div
              className="mt-6 text-center font-mono text-[11px] text-muted-foreground"
              data-testid="results-footer"
            >
              {t('footer', {
                shown: list.items.length.toLocaleString('en-US'),
                total: total.toLocaleString('en-US'),
              })}
            </div>
          ) : null}
        </div>
      </div>

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <RenameDialog
        key={renaming?.id ?? 'none'}
        flow={renaming}
        onClose={() => setRenaming(null)}
        onDone={async () => {
          toast(tr('toast'), 'success');
          setRenaming(null);
          await refresh();
        }}
        onError={fail}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={td('title')}
        message={td('message', { name: deleting?.name ?? '' })}
        confirmLabel={td('confirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function TemplateGallery({
  templates,
  onUse,
}: {
  templates: FlowTemplateCard[];
  onUse: (t: FlowTemplateCard) => void;
}) {
  const t = useTranslations('flb.templates');
  const badge: Record<string, [string, string]> = {
    chat: [t('typeChat'), 'bg-[var(--flb-mint)] text-brand'],
    call: [t('typeCall'), 'bg-amber-100/60 text-[#7B5A14]'],
    instagram: [t('typeInstagram'), 'bg-[#EFE5F5] text-[#5B3D8A]'],
  };
  return (
    <section className="mb-6">
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('eyebrow')}
        </div>
        <h2 className="font-serif text-[20px] leading-tight">{t('title')}</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((tpl) => {
          const b = badge[tpl.flowType] ?? ['—', 'bg-muted text-muted-foreground'];
          return (
            <div
              key={tpl.id}
              className="flex flex-col rounded-[14px] border border-border bg-background p-4 shadow-sm transition hover:border-brand hover:shadow-md"
              data-template={tpl.id}
            >
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold break-words">{tpl.name}</span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${b[1]}`}
                >
                  {b[0]}
                </span>
              </div>
              <p className="flex-1 text-[12px] leading-snug text-muted-foreground">
                {tpl.description || t('fallbackDescription')}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {t('steps', { count: tpl.steps })}
                  {tpl.category ? ` · ${tpl.category}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onUse(tpl)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-brand-foreground hover:opacity-90"
                >
                  <Svg d="M5 5h8v8H5zM3 10.5H2.5V2.5h8V3" className="h-3 w-3" />
                  {t('use')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Flows > Builder: this workspace's own builder, or the platform default (set in the admin panel). */
function BuilderPicker({
  platform,
  own,
  onChange,
}: {
  platform: BuilderMode;
  own: BuilderMode | null;
  onChange: (mode: 'inherit' | BuilderMode) => void;
}) {
  const t = useTranslations('flb.list.builder');
  return (
    <label
      className="flex items-center gap-2 rounded-full border border-border bg-background py-1.5 pr-2 pl-4 text-[12px] font-medium"
      title={t('title')}
    >
      {t('label')}
      <select
        data-builder-mode
        value={own ?? 'inherit'}
        onChange={(e) => onChange(e.target.value as 'inherit' | BuilderMode)}
        className="rounded-full bg-transparent py-0.5 text-[12px] font-semibold text-brand outline-none"
      >
        <option value="inherit">{t('inherit', { mode: t(platform) })}</option>
        <option value="simple">{t('simple')}</option>
        <option value="advanced">{t('advanced')}</option>
      </select>
    </label>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('flb.create');
  const tc = useTranslations('flb.common');
  const router = useRouter();
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const row = (
    href: string,
    title: string,
    note: string,
    icon: string,
    bg: string,
    channel: string,
  ) => (
    <button
      type="button"
      onClick={() => go(href)}
      data-channel={channel}
      className="group flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition hover:border-brand hover:bg-muted"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
        <Svg d={icon} className="h-5 w-5 text-brand" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">{title}</span>
        <span className="block text-[11.5px] text-muted-foreground">{note}</span>
      </span>
      <Svg
        d="M6 3l5 5-5 5"
        className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand"
      />
    </button>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <>
          {t('title')} <span className="text-brand italic">{t('titleAccent')}</span>?
        </>
      }
      eyebrow={t('eyebrow')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tc('cancel')}
        </Button>
      }
    >
      <p className="mb-3 text-[12px] text-muted-foreground">{t('subtitle')}</p>
      <div className="space-y-2">
        {row(
          '/flows/builder',
          t('messaging'),
          t('messagingNote'),
          'M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5v-3Z',
          'bg-[var(--flb-mint)]',
          'chat',
        )}
        {row(
          '/flows/builder?type=call',
          t('call'),
          t('callNote'),
          'M3 4c0 5 4 9 9 9l1.5-2.5-3-1.5-1 1A7 7 0 0 1 6 6l1-1L5.5 2 3 3.5z',
          'bg-muted',
          'call',
        )}
      </div>
    </Modal>
  );
}

function RenameDialog({
  flow,
  onClose,
  onDone,
  onError,
}: {
  flow: FlowSummary | null;
  onClose: () => void;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const t = useTranslations('flb.rename');
  const tc = useTranslations('flb.common');
  // Re-keyed per flow by the caller, so the field starts from that flow's name.
  const [name, setName] = useState(flow?.name ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const v = name.trim();
    // Empty or unchanged names are ignored client-side (the server would answer 422 for empty).
    if (!flow || !v || v === flow.name) return onClose();
    setBusy(true);
    try {
      await flowsApi.rename(flow.id, v);
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={flow !== null}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {t('save')}
          </Button>
        </>
      }
    >
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">{t('label')}</span>
        <input
          autoFocus
          value={name}
          maxLength={191}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>
    </Modal>
  );
}
