'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CAMPAIGN_STATUSES, WIZARD_SCHEDULE_MODES } from '@crm/contracts';
import { Input, Select, cn } from '@crm/ui';
import { useBroadcastHistory, type HistoryQuery } from '../api';
import { rowHref } from '../lib';
import { useDebounced, usePaging } from '../use-paging';
import { useScrollTo, useWorkspaceTime } from '../use-history';
import {
  Body,
  EmptyList,
  HistoryFrame,
  NUM,
  NewChip,
  Pager,
  StatusChip,
  TD,
  TH,
  TableBox,
  TypeBadge,
  rowClass,
} from './parts';

type View = 'list' | 'blocks';
const VIEW_KEY = 'campaigns.history.view';

const ICON = 'size-4';
const ListViewIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className={ICON}
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
    className={ICON}
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

/** The list or block choice, kept in this browser. */
function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>('list');
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read after mount so the server and first paint agree
      if (localStorage.getItem(VIEW_KEY) === 'blocks') setView('blocks');
    } catch {
      /* storage can be blocked */
    }
  }, []);
  return [
    view,
    (v) => {
      setView(v);
      try {
        localStorage.setItem(VIEW_KEY, v);
      } catch {
        /* storage can be blocked */
      }
    },
  ];
}

type Filters = Pick<HistoryQuery, 'type' | 'status' | 'from' | 'to' | 'q'>;
const NO_FILTERS: Filters = { type: '', status: '', from: '', to: '', q: '' };

/** `/campaigns/history`: every broadcast that has run or is running, with how it was sent (now, scheduled, a recurring run). */
export function BroadcastHistoryScreen({ highlight }: { highlight: string | null }) {
  const t = useTranslations('campaigns.history');
  const ts = useTranslations('campaigns.wizard.status.state');
  const router = useRouter();
  const time = useWorkspaceTime();
  const scrollTo = useScrollTo();
  const [f, setF] = useState<Filters>({ ...NO_FILTERS });
  const [view, setView] = useView();
  const q = useDebounced(f.q.trim());
  const key = JSON.stringify([f.type, f.status, f.from, f.to, q]);
  const paging = usePaging(key);
  const res = useBroadcastHistory(
    { type: f.type, status: f.status, from: f.from, to: f.to, q, cursor: paging.cursor },
    time.zone,
  );
  const filtered = Boolean(f.type || f.status || f.from || f.to || f.q.trim());
  const rows = res.data?.data ?? [];
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((o) => ({ ...o, [k]: v }));

  const filters = (
    <div className="flex flex-wrap items-end gap-3" role="search">
      <label className="min-w-[12rem] flex-1 text-xs text-muted-foreground">
        {t('filters.search')}
        <Input
          type="search"
          value={f.q}
          maxLength={120}
          placeholder={t('filters.searchPlaceholder')}
          onChange={(e) => set('q', e.target.value)}
          className="mt-1"
        />
      </label>
      <label className="w-44 text-xs text-muted-foreground">
        {t('filters.type')}
        <Select
          value={f.type}
          onChange={(e) => set('type', e.target.value as Filters['type'])}
          className="mt-1"
        >
          <option value="">{t('filters.allTypes')}</option>
          {WIZARD_SCHEDULE_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`type.${m}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="w-40 text-xs text-muted-foreground">
        {t('filters.status')}
        <Select
          value={f.status}
          onChange={(e) => set('status', e.target.value as Filters['status'])}
          className="mt-1"
        >
          <option value="">{t('filters.allStatuses')}</option>
          {CAMPAIGN_STATUSES.filter((s) => s !== 'draft' && s !== 'scheduled').map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Select>
      </label>
      <label className="w-40 text-xs text-muted-foreground">
        {t('filters.from')}
        <Input
          type="date"
          value={f.from}
          max={f.to || undefined}
          onChange={(e) => set('from', e.target.value)}
          className="mt-1"
        />
      </label>
      <label className="w-40 text-xs text-muted-foreground">
        {t('filters.to')}
        <Input
          type="date"
          value={f.to}
          min={f.from || undefined}
          onChange={(e) => set('to', e.target.value)}
          className="mt-1"
        />
      </label>
      <div
        role="group"
        aria-label={t('view.label')}
        className="ms-auto flex overflow-hidden rounded-md border border-border"
      >
        {(['list', 'blocks'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`history-view-${v}`}
            aria-pressed={view === v}
            title={t(`view.${v}`)}
            aria-label={t(`view.${v}`)}
            onClick={() => setView(v)}
            className={cn(
              'grid size-10 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-primary',
              view === v ? 'bg-brand text-brand-foreground' : 'bg-background hover:bg-muted',
            )}
          >
            {v === 'list' ? <ListViewIcon /> : <BlockViewIcon />}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <HistoryFrame
      title={t('history.title')}
      hint={t('history.hint')}
      filters={filters}
      footer={null}
      legacy
    >
      <Body
        pending={res.isPending}
        error={res.isError ? res.error : null}
        onRetry={() => void res.refetch()}
        empty={
          rows.length === 0 ? (
            <EmptyList
              filtered={filtered}
              none={t('history.empty')}
              onClear={() => setF({ ...NO_FILTERS })}
            />
          ) : null
        }
      >
        {view === 'blocks' ? (
          <ul
            data-testid="history-blocks"
            className="grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-auto p-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {rows.map((r) => {
              const href = rowHref(r);
              const mark = highlight !== null && (r.id === highlight || r.seriesId === highlight);
              return (
                <li
                  key={r.id}
                  ref={mark ? scrollTo : undefined}
                  aria-current={mark ? 'true' : undefined}
                  className={cn(
                    'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-sm transition hover:shadow',
                    mark && 'ring-2 ring-brand/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={href}
                        className="block truncate font-semibold text-brand hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        {[
                          r.templateName,
                          r.occurrence !== null ? t('runNumber', { n: r.occurrence }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '-'}
                      </div>
                    </div>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge type={r.type} />
                    {mark && <NewChip />}
                    <span className="text-xs text-muted-foreground">{r.senderLabel ?? '-'}</span>
                  </div>
                  <dl className="grid grid-cols-4 gap-2 text-center">
                    {(
                      [
                        ['audience', r.counts.recipients],
                        ['sent', r.counts.sent],
                        ['delivered', r.counts.delivered],
                        ['failed', r.counts.failed],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-muted/60 px-1 py-2">
                        <dd className="text-sm font-semibold tabular-nums">{v.toLocaleString()}</dd>
                        <dt className="text-[11px] text-muted-foreground">{t(`col.${k}`)}</dt>
                      </div>
                    ))}
                  </dl>
                  <div className="text-xs text-muted-foreground">
                    {t('col.started')}: {time.when(r.startedAt)}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <TableBox label={t('history.title')}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {t('col.name')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.type')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.template')}
                </th>
                <th scope="col" className={`${TH} text-end`}>
                  {t('col.audience')}
                </th>
                <th scope="col" className={`${TH} text-end`}>
                  {t('col.sent')}
                </th>
                <th scope="col" className={`${TH} text-end`}>
                  {t('col.delivered')}
                </th>
                <th scope="col" className={`${TH} text-end`}>
                  {t('col.failed')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.status')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.started')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.finished')}
                </th>
                <th scope="col" className={TH}>
                  {t('col.sender')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = rowHref(r);
                const mark = highlight !== null && (r.id === highlight || r.seriesId === highlight);
                return (
                  <tr
                    key={r.id}
                    ref={mark ? scrollTo : undefined}
                    aria-current={mark ? 'true' : undefined}
                    className={`${rowClass(mark)} cursor-pointer`}
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('a,button')) router.push(href);
                    }}
                  >
                    <td className={`${TD} max-w-[16rem]`}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={href}
                          className="truncate font-medium text-brand hover:underline"
                        >
                          {r.name}
                        </Link>
                        {mark && <NewChip />}
                      </div>
                      {r.occurrence !== null && (
                        <div className="text-xs text-muted-foreground">
                          {t('runNumber', { n: r.occurrence })}
                        </div>
                      )}
                    </td>
                    <td className={TD}>
                      <TypeBadge type={r.type} />
                    </td>
                    <td className={`${TD} max-w-[12rem] truncate`}>{r.templateName ?? '-'}</td>
                    <td className={`${TD} ${NUM}`}>{r.counts.recipients.toLocaleString()}</td>
                    <td className={`${TD} ${NUM}`}>{r.counts.sent.toLocaleString()}</td>
                    <td className={`${TD} ${NUM}`}>{r.counts.delivered.toLocaleString()}</td>
                    <td className={`${TD} ${NUM}`}>{r.counts.failed.toLocaleString()}</td>
                    <td className={TD}>
                      <StatusChip status={r.status} />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{time.when(r.startedAt)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{time.when(r.finishedAt)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{r.senderLabel ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </TableBox>
        )}
        <Pager
          shown={rows.length}
          page={paging.page}
          hasPrev={paging.hasPrev}
          hasNext={Boolean(res.data?.page.nextCursor)}
          busy={res.isFetching}
          onPrev={paging.prev}
          onNext={() => res.data?.page.nextCursor && paging.next(res.data.page.nextCursor)}
        />
      </Body>
    </HistoryFrame>
  );
}
