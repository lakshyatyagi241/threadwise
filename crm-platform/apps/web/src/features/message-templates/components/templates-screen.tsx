'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { TemplateSummary, TplMetaCategory } from '@crm/contracts';
import { Button, EmptyState, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  useConnections,
  useDebounced,
  useSyncTemplates,
  useTemplateCounts,
  useTemplateList,
} from '../api/hooks';
import { CATEGORIES, SORTS, STATUS_TABS, type StatusTab } from '../lib/status-model';
import { connectionLabel, summarizeSync, syncTargets } from '../lib/sync';
import { DeleteTemplateDialog } from './delete-dialog';
import { ErrorAlert } from './error-line';
import { PlusIcon, RefreshIcon, SearchIcon } from './icons';
import { TemplateCard } from './template-card';
import { useErrorText } from './use-error-text';

const GUIDELINES = 'https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/';

const DOT: Record<StatusTab, string> = {
  all: 'bg-border',
  approved: 'bg-success',
  pending: 'bg-warning',
  rejected: 'bg-danger',
};

const PILL_SELECT =
  'h-8 shrink-0 rounded-full border border-border bg-background px-3 font-mono text-xs hover:bg-muted focus:border-brand focus:outline-none';

const isTab = (v: string | null): v is StatusTab => STATUS_TABS.includes(v as StatusTab);
const isSort = (v: string | null): v is (typeof SORTS)[number] => SORTS.includes(v as never);

/**
 * TW-TPL-001, the Reference Template library: a rail with the status list, a header, category tabs, sort and search on one
 * row, a grid of cards, and three help cards. The filters live in the URL so a reload or a shared link keeps them.
 * Pages are "Load more" over the API's cursor (no page numbers), eight at a time like Reference's page.
 */
export function TemplatesScreen() {
  const t = useTranslations('message-templates.library');
  const tc = useTranslations('message-templates.category');
  const errorText = useErrorText();
  const mayCreate = useCan('tpl.templates.create');
  const mayDelete = useCan('tpl.templates.delete');
  const maySync = useCan('tpl.templates.sync');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlStatus = params.get('status');
  const urlSort = params.get('sort');
  const status: StatusTab = isTab(urlStatus) ? urlStatus : 'all';
  const sort = isSort(urlSort) ? urlSort : 'newest';
  const category = CATEGORIES.find((c) => c === params.get('category')?.toUpperCase()) ?? 'all';
  const connectionId = params.get('number') ?? '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim(), 250);

  /** Writes filters into the URL (defaults are left out, so the plain library is just /templates). */
  function put(next: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v && v !== 'all' && !(k === 'sort' && v === 'newest')) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  useEffect(() => {
    if (q !== (params.get('q') ?? '')) put({ q });
    // The URL is the state: only the debounced search text is pushed into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filters = {
    statusGroup: status === 'all' ? undefined : status,
    category: category === 'all' ? undefined : (category as TplMetaCategory),
    connectionId: connectionId || undefined,
    q,
    sort,
  };
  const connections = useConnections();
  const list = useTemplateList(filters);
  const counts = useTemplateCounts(filters);
  const sync = useSyncTemplates();
  const [syncing, setSyncing] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [toDelete, setToDelete] = useState<TemplateSummary | null>(null);

  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of connections.data ?? []) m.set(c.id, connectionLabel(c));
    return m;
  }, [connections.data]);

  const targets = syncTargets(connections.data ?? [], connectionId || undefined);
  const total = counts.data?.statuses.all ?? 0;
  const filtered = counts.data?.filtered ?? list.items.length;
  const empty = !list.isPending && !list.isError && list.items.length === 0;
  const anyFilter = status !== 'all' || category !== 'all' || connectionId !== '' || q !== '';
  const tabs: Array<{ key: string; label: string; count: number }> = [
    { key: 'all', label: t('tabAll'), count: counts.data?.categories.all ?? 0 },
    ...CATEGORIES.filter((c) => (counts.data?.categories[c] ?? 0) > 0).map((c) => ({
      key: c,
      label: tc(c),
      count: counts.data?.categories[c] ?? 0,
    })),
  ];

  async function runSync() {
    setSyncing(true);
    setBanner(null);
    const results = [];
    for (const id of targets) {
      try {
        results.push(await sync.mutateAsync({ connectionId: id }));
      } catch {
        results.push(null);
      }
    }
    setSyncing(false);
    const s = summarizeSync(results);
    if (s.succeeded === 0) {
      setBanner({ tone: 'error', text: t('syncFailed') });
      return;
    }
    const base =
      s.total === 0 && s.created === 0
        ? t('syncNone')
        : t('syncDone', { created: s.created, updated: s.updated, missing: s.missing });
    setBanner({
      tone: s.failed > 0 ? 'error' : 'ok',
      text: s.failed > 0 ? `${base} ${t('syncPartial', { count: s.failed })}` : base,
    });
  }

  const guidelineLink = (chunks: React.ReactNode) => (
    <a
      href={GUIDELINES}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-brand underline"
    >
      {chunks}
    </a>
  );

  // The big title shrinks once the page scrolls, so the pinned header takes little room (two thresholds so it does not flicker).
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () =>
      setStuck((was) => (window.scrollY > 140 ? true : window.scrollY < 20 ? false : was));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="px-4 py-7 sm:px-6 lg:px-7">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* ===== rail ===== */}
        <aside className="space-y-3 self-start lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <div className="rounded-2xl border border-success/30 bg-success/10 p-3.5 text-[11.5px] leading-relaxed">
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              {t('tipTitle')}
            </p>
            {t('tip')}
          </div>

          <nav
            aria-label={t('statusTitle')}
            className="rounded-2xl border border-border bg-background p-2 shadow-sm"
          >
            <p className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('statusTitle')}
            </p>
            {STATUS_TABS.map((s) => {
              const active = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  data-testid={`status-${s}`}
                  onClick={() => put({ status: s })}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-[13px]',
                    active ? 'bg-brand font-semibold text-brand-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', DOT[s])} aria-hidden="true" />
                    {t(`statusTab.${s}`)}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-[11px]',
                      active ? 'opacity-90' : 'text-muted-foreground',
                    )}
                  >
                    {(counts.data?.statuses[s] ?? 0).toLocaleString()}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="rounded-2xl border border-border bg-brand/10 p-3 text-[11px] leading-relaxed">
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
              <span className="size-2.5 rounded-full bg-brand" aria-hidden="true" />
              {t('quickStartTitle')}
            </p>
            {t.rich('quickStart', { link: guidelineLink })}
          </div>
        </aside>

        {/* ===== main ===== */}
        <main className="min-w-0">
          <div className="sticky top-14 z-30 -me-4 bg-background/95 pe-4 backdrop-blur sm:-me-6 sm:pe-6 lg:-me-7 lg:pe-7">
            <header
              className={cn(
                'flex flex-wrap items-end justify-between gap-4',
                stuck ? 'pt-2 pb-1' : 'mb-4',
              )}
            >
              <div className="min-w-0">
                {!stuck && (
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t('crumb')}
                  </p>
                )}
                <h1
                  className={cn(
                    'font-serif font-normal leading-none tracking-tight',
                    stuck ? 'text-[22px]' : 'text-[32px] sm:text-[40px] lg:text-[44px]',
                  )}
                >
                  {t('titleA')} <span className="italic text-brand">{t('titleB')}</span>.
                </h1>
                {!stuck && (
                  <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
                    {t.rich('intro', { link: guidelineLink })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">
                {maySync && targets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void runSync()}
                    disabled={syncing}
                    title={t('syncHint')}
                    className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold hover:border-brand disabled:opacity-60"
                  >
                    {syncing ? <Spinner /> : <RefreshIcon className="size-3.5" />}
                    {syncing ? t('syncing') : t('sync')}
                  </button>
                )}
                {mayCreate && (
                  <Link
                    href="/templates/new"
                    className="flex items-center gap-2 whitespace-nowrap rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90"
                  >
                    <PlusIcon className="size-3.5" />
                    {t('new')}
                  </Link>
                )}
              </div>
            </header>
            {/* tabs, number, sort, search: one row */}
            <div
              className={cn(
                stuck ? 'mt-1' : 'mt-5',
                'flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-2',
              )}
            >
              <div
                role="tablist"
                aria-label={t('categories')}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-6"
              >
                {tabs.map((tab) => {
                  const active = category === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => put({ category: tab.key })}
                      className={cn(
                        '-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 py-3.5 text-sm transition',
                        active
                          ? 'border-brand font-semibold text-brand'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {tab.label}
                      <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                        {tab.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
              {(connections.data?.length ?? 0) > 1 && (
                <select
                  aria-label={t('connection')}
                  title={t('connection')}
                  className={PILL_SELECT}
                  value={connectionId}
                  onChange={(e) => put({ number: e.target.value })}
                >
                  <option value="">{t('allConnections')}</option>
                  {(connections.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {connectionLabel(c)}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label={t('sortLabel')}
                className={PILL_SELECT}
                value={sort}
                onChange={(e) => put({ sort: e.target.value })}
              >
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort.${s}`)}
                  </option>
                ))}
              </select>
              <div className="relative my-2 shrink-0">
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  aria-label={t('search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="h-8 w-64 max-w-full rounded-full border border-border bg-background pe-3 ps-9 text-xs focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          </div>

          {banner && (
            <div
              role={banner.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'mt-3 mb-1 rounded-xl border px-4 py-3 text-[12.5px]',
                banner.tone === 'error'
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : 'border-success/40 bg-success/10 text-success',
              )}
            >
              {banner.tone === 'error' && (
                <span className="font-semibold">{t('syncFailedLabel')} </span>
              )}
              {banner.text}
            </div>
          )}

          {!list.isPending && total > 0 && (
            <div className="mb-3 mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 font-mono text-[11px] text-muted-foreground">
              <span>
                {t('showing')}{' '}
                <b className="text-foreground">
                  {list.items.length.toLocaleString()} {t('of')} {filtered.toLocaleString()}
                </b>{' '}
                {t('filteredTemplates')}
              </span>
              <span className="flex items-center gap-3">
                {(['approved', 'pending', 'rejected'] as const).map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', DOT[s])} aria-hidden="true" />
                    {t(`legend.${s}`)}
                  </span>
                ))}
              </span>
            </div>
          )}

          <section
            aria-live="polite"
            aria-busy={list.isFetching}
            className={cn(
              'mt-3',
              list.isFetching && !list.isPending && 'opacity-60 transition-opacity',
            )}
          >
            {list.isPending ? (
              <div className="flex justify-center p-12">
                <Spinner label={t('loading')} />
              </div>
            ) : list.isError ? (
              <div className="space-y-3">
                <ErrorAlert error={errorText(list.error)} />
                <Button variant="secondary" onClick={() => void list.refetch()}>
                  {t('retry')}
                </Button>
              </div>
            ) : empty ? (
              <EmptyState
                title={anyFilter ? t('emptyFilteredTitle') : t('emptyTitle')}
                message={anyFilter ? t('emptyFilteredBody') : t('emptyBody')}
                actions={
                  anyFilter ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        router.replace(pathname, { scroll: false });
                      }}
                    >
                      {t('clearFilters')}
                    </Button>
                  ) : (
                    mayCreate && (
                      <Link
                        href="/templates/new"
                        className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground"
                      >
                        {t('createTemplate')}
                      </Link>
                    )
                  )
                }
              />
            ) : (
              <>
                <ul className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {list.items.map((tpl) => (
                    <li key={tpl.id} className="flex">
                      <TemplateCard
                        template={tpl}
                        connectionLabel={
                          tpl.connectionId ? (labels.get(tpl.connectionId) ?? null) : null
                        }
                        mayEdit={mayCreate}
                        mayDelete={mayDelete}
                        onDelete={setToDelete}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {t('showingRange', {
                      shown: list.items.length.toLocaleString(),
                      total: filtered.toLocaleString(),
                    })}
                  </span>
                  {list.hasNextPage && (
                    <Button
                      variant="secondary"
                      onClick={() => void list.fetchNextPage()}
                      disabled={list.isFetchingNextPage}
                    >
                      {list.isFetchingNextPage && <Spinner />}
                      {t('loadMore')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(['one', 'two', 'three'] as const).map((k, i) => (
              <section
                key={k}
                className="rounded-2xl border border-border bg-background p-5 shadow-sm"
              >
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('helpLabel', { n: i + 1 })}
                </p>
                <h2 className="mb-1 font-serif text-[20px] font-normal tracking-tight">
                  {t(`help.${k}.title`)}
                </h2>
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  {t(`help.${k}.body`)}
                </p>
              </section>
            ))}
          </div>
        </main>
      </div>

      <DeleteTemplateDialog template={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
