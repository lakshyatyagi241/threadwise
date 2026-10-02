'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Select, Spinner, cn } from '@crm/ui';
import { useCan, useSession } from '@/features/auth-registration-security/shared/session-context';
import {
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  frozenEdge,
  isScrolledSideways,
} from '@/features/contacts-attributes-tags';
import { useStoredValue } from '@/lib/use-stored-value';
import { useSegmentCatalog } from '../api/lookups';
import { useSegments } from '../api/segments';
import type { Segment } from '../api/schemas';
import { filterSegments, needsAttention, pageWindow } from '../lib/hub';
import { summarize } from '../lib/summary';
import {
  HUB_PAGE_SIZES,
  ROUTES,
  SHOW_VALUES,
  hubToSearch,
  parseHub,
  type HubPageSize,
  type HubParams,
} from '../lib/url';
import { fromWire } from '../lib/wire';
import {
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FunnelIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TagIcon,
  TrashIcon,
  UsersPlusIcon,
} from './icons';
import {
  AttentionChip,
  ColorDot,
  ErrorLine,
  GroupVsSegment,
  MemberCount,
  VisibilityChip,
} from './parts';
import { SegmentDialogs, useSegmentActions, useSegmentCan, type SegmentActions } from './segment-actions';
import { useSummaryContext } from './use-summary';

const HELP_KEY = 'segments:hub:help';

const th =
  'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const SURFACE = 'bg-background group-hover:bg-muted';
const NAME_CELL = `sticky start-0 z-10 ${SURFACE}`;
const NAME_HEAD = 'start-0 z-30 bg-muted';
const WIDTHS = { name: 320, rules: 380, members: 150, visibility: 120, owner: 150, updated: 170, actions: 56 } as const;
const MIN_WIDTH = Object.values(WIDTHS).reduce((a, b) => a + b, 0);

/**
 * `/segments`, the Segments hub: every segment the person can see, with its rule as a sentence, its member count and
 * the actions. The search, the Mine / Shared filter and the page live in the URL.
 */
export function SegmentsScreen() {
  const t = useTranslations('segments.hub');
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const me = useSession().user.id;
  const can = useSegmentCan();
  const canRead = useCan('record.segments.read');
  const list = useSegments(canRead);
  const lookups = useSegmentCatalog();
  const summaryCtx = useSummaryContext(lookups.catalog);
  const [helpRaw, setHelpRaw] = useStoredValue(HELP_KEY);
  const showHelp = helpRaw === '1';

  const params = useMemo(() => parseHub(search), [search]);
  const setParams = (patch: Partial<HubParams>) =>
    router.replace(`${pathname}${hubToSearch({ ...params, page: 1, ...patch })}`, { scroll: false });

  // Search is applied 300 ms after typing stops, without a page reload.
  const [q, setQ] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    setQ(params.q);
  }
  useEffect(() => {
    if (q.trim() === params.q.trim()) return;
    const id = window.setTimeout(() => setParams({ q: q.trim() }), 300);
    return () => window.clearTimeout(id);
    // setParams closes over the current params; the timer restarts on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = useMemo(() => filterSegments(all, params, me), [all, params, me]);
  const view = useMemo(() => pageWindow(rows, params.page, params.per), [rows, params.page, params.per]);
  const filtered = params.q.trim() !== '' || params.show !== 'all';

  // A page past the end (rows were deleted) steps back, in the URL too.
  useEffect(() => {
    if (list.isSuccess && view.page !== params.page) {
      router.replace(`${pathname}${hubToSearch({ ...params, page: view.page })}`, { scroll: false });
    }
    // Only a settled list decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.isSuccess, view.page]);

  const actions = useSegmentActions({ taken: () => all.map((s) => s.name) });

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <FunnelIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        {can.create && (
          <Button variant="brand" className="h-10 px-5" onClick={() => router.push(ROUTES.create)}>
            <PlusIcon /> {t('create')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="h-9 ps-9 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <div role="group" aria-label={t('showLabel')} className="inline-flex overflow-hidden rounded-md border border-border">
          {SHOW_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={params.show === v}
              onClick={() => setParams({ show: v })}
              className={cn(
                'h-9 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                params.show === v ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
              )}
            >
              {t(`show.${v}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={showHelp}
          onClick={() => setHelpRaw(showHelp ? '0' : '1')}
          className="inline-flex h-9 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showHelp ? t('hideHelp') : t('showHelp')}
        </button>
        <div className="ms-auto flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline" aria-live="polite">
            {list.isSuccess ? t('count', { count: rows.length }) : ''}
          </span>
          <button
            type="button"
            onClick={() => void list.refetch()}
            title={t('refresh')}
            aria-label={t('refresh')}
            className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RefreshIcon className={cn('size-4', list.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="rounded-xl border border-border bg-background p-3">
          <GroupVsSegment />
        </div>
      )}

      <section
        aria-label={t('tableLabel')}
        aria-busy={list.isFetching}
        className="flex max-h-[max(26rem,calc(100dvh-15rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {!canRead ? (
            <div className="p-4">
              <EmptyState title={t('noAccessTitle')} message={t('noAccess')} />
            </div>
          ) : list.isPending ? (
            <ListSkeleton label={t('loading')} />
          ) : list.isError ? (
            <div className="p-4">
              <ErrorLine error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : all.length === 0 ? (
            <div className="space-y-4 p-4">
              <EmptyState
                title={t('emptyTitle')}
                message={t('empty')}
                actions={
                  can.create ? (
                    <Button variant="brand" onClick={() => router.push(ROUTES.create)}>
                      <PlusIcon /> {t('createFirst')}
                    </Button>
                  ) : undefined
                }
              />
              <GroupVsSegment />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t('emptyFilteredTitle')}
                message={t('emptyFiltered')}
                actions={
                  filtered ? (
                    <Button variant="secondary" onClick={() => router.replace(pathname)}>
                      {t('resetFilters')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <SegmentsTable
              rows={view.items}
              actions={actions}
              sentence={(s) => (lookups.ready ? summarize(fromWire(s.rules), summaryCtx) : null)}
              personName={lookups.personName}
              can={can}
            />
          )}
        </div>
        {list.isSuccess && rows.length > 0 && (
          <Footer
            window={view}
            per={params.per}
            loading={list.isFetching}
            onPage={(page) => setParams({ page })}
            onPer={(per) => setParams({ per })}
          />
        )}
      </section>

      <SegmentDialogs controller={actions} />
    </div>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y divide-border">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-16 animate-pulse items-center gap-4 px-4">
          <span className="size-3 rounded-full bg-muted" />
          <span className="h-3 w-40 rounded bg-muted" />
          <span className="hidden h-3 w-56 rounded bg-muted md:block" />
          <span className="ms-auto h-3 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SegmentsTable({
  rows,
  actions,
  sentence,
  personName,
  can,
}: {
  rows: Segment[];
  actions: SegmentActions;
  sentence: (s: Segment) => string | null;
  personName: (id: string | null | undefined) => string | undefined;
  can: ReturnType<typeof useSegmentCan>;
}) {
  const t = useTranslations('segments.hub');
  const format = useFormatter();
  const [scrolled, setScrolled] = useState(false);
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: MIN_WIDTH }}>
        <colgroup>
          <col className="w-[220px] sm:w-[320px]" />
          <col style={{ width: WIDTHS.rules }} />
          <col style={{ width: WIDTHS.members }} />
          <col style={{ width: WIDTHS.visibility }} />
          <col style={{ width: WIDTHS.owner }} />
          <col style={{ width: WIDTHS.updated }} />
          <col style={{ width: WIDTHS.actions }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={cn(th, NAME_HEAD, frozenEdge(scrolled))}>{t('colName')}</th>
            <th scope="col" className={th}>{t('colRules')}</th>
            <th scope="col" className={th}>{t('colMembers')}</th>
            <th scope="col" className={th}>{t('colVisibility')}</th>
            <th scope="col" className={th}>{t('colOwner')}</th>
            <th scope="col" className={th}>{t('colUpdated')}</th>
            <th scope="col" className={cn(th, 'end-0 z-30 px-1')}><span className="sr-only">{t('colActions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const text = sentence(s);
            const owner = s.ownerName ?? personName(s.ownerId);
            return (
              <tr key={s.id} className="group h-16 align-middle transition-colors hover:bg-muted">
                <td className={cn('max-w-0 border-b border-border px-3 py-2', NAME_CELL, frozenEdge(scrolled))}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ColorDot color={s.color} />
                    <div className="min-w-0">
                      <Link
                        href={ROUTES.detail(s.id)}
                        title={s.name}
                        className="block truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {s.name}
                      </Link>
                      {s.description && (
                        <span title={s.description} className="block truncate text-xs text-muted-foreground">{s.description}</span>
                      )}
                      {needsAttention(s) && <AttentionChip count={s.invalidConditions.length} />}
                    </div>
                  </div>
                </td>
                <td className="max-w-0 border-b border-border px-3 py-2">
                  {text === null ? (
                    <span className="block h-3 w-48 animate-pulse rounded bg-muted" />
                  ) : (
                    <span title={text} className="line-clamp-2 text-muted-foreground">{text || '-'}</span>
                  )}
                </td>
                <td className="border-b border-border px-3 py-2">
                  <MemberCount
                    segment={s}
                    refreshing={actions.refreshing.has(s.id)}
                    onRefresh={() => void actions.refresh(s)}
                  />
                </td>
                <td className="border-b border-border px-3 py-2"><VisibilityChip visibility={s.visibility} /></td>
                <td className="max-w-0 border-b border-border px-3 py-2">
                  <span title={owner} className="block truncate">{owner ?? '-'}</span>
                </td>
                <td className="border-b border-border px-3 py-2 tabular-nums text-muted-foreground">
                  {format.dateTime(new Date(s.updatedAt), { dateStyle: 'medium' })}
                </td>
                <td className={cn('sticky end-0 z-10 border-b border-border px-1 py-2 text-center', SURFACE)}>
                  <RowActions segment={s} actions={actions} can={can} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The "..." menu of a row: open, edit, duplicate, export, tag members, add to group, delete. */
export function RowActions({
  segment,
  actions,
  can,
}: {
  segment: Segment;
  actions: SegmentActions;
  can: ReturnType<typeof useSegmentCan>;
}) {
  const t = useTranslations('segments.hub');
  const router = useRouter();
  const memberActions = can.export || can.members;
  return (
    <RowMenu label={t('moreFor', { name: segment.name })} width={224}>
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <RowMenuItem onSelect={run(() => router.push(ROUTES.detail(segment.id)))}>
              <EyeIcon /> {t('open')}
            </RowMenuItem>
            {can.edit(segment) && (
              <RowMenuItem onSelect={run(() => router.push(ROUTES.edit(segment.id)))}>
                <PencilIcon /> {t('edit')}
              </RowMenuItem>
            )}
            {can.create && (
              <RowMenuItem onSelect={run(() => void actions.duplicate(segment))}>
                <CopyIcon /> {t('duplicate')}
              </RowMenuItem>
            )}
            {memberActions && <RowMenuSeparator />}
            {can.export && (
              <RowMenuItem
                disabled={actions.exporting.has(segment.id)}
                onSelect={run(() => void actions.exportCsv(segment))}
              >
                <DownloadIcon /> {t('export')}
              </RowMenuItem>
            )}
            {can.members && (
              <>
                <RowMenuItem onSelect={run(() => actions.open('tag', segment))}>
                  <TagIcon /> {t('tagMembers')}
                </RowMenuItem>
                <RowMenuItem onSelect={run(() => actions.open('group', segment))}>
                  <UsersPlusIcon /> {t('addToGroup')}
                </RowMenuItem>
              </>
            )}
            {can.remove(segment) && (
              <>
                <RowMenuSeparator />
                <RowMenuItem danger onSelect={run(() => actions.open('delete', segment))}>
                  <TrashIcon /> {t('delete')}
                </RowMenuItem>
              </>
            )}
          </>
        );
      }}
    </RowMenu>
  );
}

function Footer({
  window: w,
  per,
  loading,
  onPage,
  onPer,
}: {
  window: ReturnType<typeof pageWindow<Segment>>;
  per: HubPageSize;
  loading: boolean;
  onPage: (page: number) => void;
  onPer: (per: HubPageSize) => void;
}) {
  const t = useTranslations('segments.hub');
  const btn =
    'inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
        {loading && <Spinner label={t('loading')} />}
        {t('range', { from: w.from, to: w.to, total: w.total })}
      </div>
      <nav aria-label={t('pagination')} className="flex items-center gap-2">
        <button type="button" className={btn} disabled={w.page <= 1} onClick={() => onPage(w.page - 1)}>
          {t('previous')}
        </button>
        <span className="tabular-nums text-muted-foreground">{t('pageOf', { page: w.page, pages: w.pages })}</span>
        <button type="button" className={btn} disabled={w.page >= w.pages} onClick={() => onPage(w.page + 1)}>
          {t('next')}
        </button>
        <Select
          aria-label={t('perPage')}
          className="h-8 w-auto py-0"
          value={per}
          onChange={(e) => onPer(Number(e.target.value) as HubPageSize)}
        >
          {HUB_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {t('perPageOption', { count: n })}
            </option>
          ))}
        </Select>
      </nav>
    </div>
  );
}
