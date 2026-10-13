'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, EmptyState, Select, Spinner, cn } from '@crm/ui';
import { EmailChannelOptions } from '@/features/channel-email/components/channel-options';
import {
  CONVERSATION_STATUSES,
  INBOX_TABS,
  type ChannelResponse,
  type InboxTab,
} from '@crm/contracts';
import {
  DEFAULT_FILTERS,
  isFiltered,
  tabCount,
  type ListFilters,
  type ListState,
} from '../lib/list';
import type { Selection } from '../lib/selection';
import { ConversationRow } from './conversation-row';
import { LabelFilter } from './label-filter';
import { FlaskIcon, RefreshIcon, SearchIcon } from './icons';
import { useErrorText } from './parts';

const SEARCH_DEBOUNCE_MS = 300;

export interface ConversationListProps {
  list: ListState;
  filters: ListFilters;
  onFilters: (patch: Partial<ListFilters>) => void;
  channels: ChannelResponse[] | undefined;
  channelsLoaded: boolean;
  activeId: string | null;
  nowMs: number;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  canManageChannels: boolean;
  simulatorAvailable: boolean;
  onOpenSimulator: () => void;
  /** Present when the caller may use bulk actions: the "Select" button, the selection and the bar shown while rows are picked. */
  bulk?: {
    selecting: boolean;
    selection: Selection;
    onToggleSelecting: () => void;
    onSelect: (id: string, shift: boolean) => void;
    bar: ReactNode;
  };
}

/**
 * The left pane: title and refresh, search, the All / Mine / Unassigned / Unread tabs with counts, the status and channel
 * filters, and the conversations with "load more" by cursor. The empty states tell a workspace with no channel what to do first.
 */
export function ConversationList(props: ConversationListProps) {
  const t = useTranslations('team-inbox-conversations.list');
  const errorText = useErrorText();
  const { list, filters, channels } = props;
  const tabsId = useId();
  const listId = useId();
  const showChannel = (channels?.length ?? 0) > 1;

  const filtered = isFiltered(filters);
  const noChannels = props.channelsLoaded && (channels?.length ?? 0) === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold leading-tight">{t('title')}</h1>
          <div className="flex items-center gap-1">
            {props.simulatorAvailable && (
              <button
                type="button"
                data-testid="inbox-simulator-open"
                title={t('openSimulator')}
                aria-label={t('openSimulator')}
                onClick={props.onOpenSimulator}
                className="flex size-8 items-center justify-center rounded-md text-warning hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              >
                <FlaskIcon />
              </button>
            )}
            {props.bulk && (
              <button
                type="button"
                data-testid="inbox-select-toggle"
                aria-pressed={props.bulk.selecting}
                onClick={props.bulk.onToggleSelecting}
                className={cn(
                  'flex h-8 items-center rounded-md px-2 text-xs font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                  props.bulk.selecting ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                {props.bulk.selecting ? t('selectDone') : t('select')}
              </button>
            )}
            <button
              type="button"
              title={t('refresh')}
              aria-label={t('refresh')}
              onClick={props.onRefresh}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        {props.bulk?.selecting && props.bulk.bar}

        <SearchBox
          value={filters.q}
          onChange={(q) => props.onFilters({ q })}
          inputRef={props.searchRef}
          label={t('search')}
          placeholder={t('searchPlaceholder')}
        />

        <TabBar
          id={tabsId}
          controls={listId}
          value={filters.tab}
          list={list}
          onChange={(tab) => props.onFilters({ tab })}
        />

        <div className="flex gap-2">
          <Select
            aria-label={t('statusFilter')}
            value={filters.status}
            onChange={(e) => props.onFilters({ status: e.target.value as ListFilters['status'] })}
            className="h-8 text-xs"
          >
            <option value="open">{t('statusOpen')}</option>
            {CONVERSATION_STATUSES.filter((s) => s !== 'open' && s !== 'closed').map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
            <option value="all">{t('statusAll')}</option>
          </Select>
          <LabelFilter value={filters.labels} onChange={(labels) => props.onFilters({ labels })} />
          {showChannel && (
            <Select
              aria-label={t('channelFilter')}
              value={filters.channelId ?? ''}
              onChange={(e) => props.onFilters({ channelId: e.target.value || null })}
              className="h-8 text-xs"
            >
              <option value="">{t('allChannels')}</option>
              {channels!
                .filter((c) => c.kind !== 'email')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              <EmailChannelOptions channels={channels!} />
            </Select>
          )}
        </div>

        {list.counts && list.counts.archived > 0 && (
          <button
            type="button"
            onClick={() => props.onFilters({ archived: !filters.archived })}
            aria-pressed={filters.archived}
            className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span>{filters.archived ? t('backToInbox') : t('archived')}</span>
            {!filters.archived && <span>{list.counts.archived}</span>}
          </button>
        )}
      </div>

      <div
        id={listId}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${filters.tab}`}
        className="min-h-0 flex-1 overflow-y-auto thin-scrollbar"
        data-testid="inbox-list"
      >
        {!list.loaded && (
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </p>
        )}

        {list.loaded && list.error && list.rows.length === 0 && (
          <div className="space-y-3 p-4 text-center">
            <p role="alert" className="text-sm text-danger">
              {errorText(list.error)}
            </p>
            <Button variant="secondary" size="sm" onClick={props.onRefresh}>
              {t('retry')}
            </Button>
          </div>
        )}

        {list.loaded && !list.error && list.rows.length === 0 && (
          <div className="p-4" data-testid="inbox-list-empty">
            {noChannels && !filtered ? (
              <EmptyState
                title={t('gettingStarted.title')}
                message={t('gettingStarted.message')}
                actions={
                  props.canManageChannels ? (
                    <Link
                      href="/inbox/channels"
                      className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      {t('gettingStarted.connect')}
                    </Link>
                  ) : undefined
                }
              />
            ) : filtered ? (
              <EmptyState
                title={t('emptyFiltered.title')}
                message={t('emptyFiltered.message')}
                actions={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => props.onFilters({ ...DEFAULT_FILTERS, tab: filters.tab })}
                  >
                    {t('emptyFiltered.clear')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t(`empty.${filters.tab}.title`)}
                message={t(`empty.${filters.tab}.message`)}
              />
            )}
          </div>
        )}

        {list.rows.length > 0 && (
          <ul aria-label={t('listLabel')}>
            {list.rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                active={row.id === props.activeId}
                nowMs={props.nowMs}
                showChannel={showChannel}
                onOpen={props.onOpen}
                selecting={props.bulk?.selecting ?? false}
                selected={props.bulk?.selection.has(row.id) ?? false}
                onSelect={props.bulk?.onSelect}
              />
            ))}
          </ul>
        )}

        {list.hasMore && <LoadMore onLoad={props.onLoadMore} failed={list.moreError} />}
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  inputRef,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // The filters were reset from outside (clear filters): the box follows.
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const id = window.setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
    // `onChange` is the screen's setter; only the draft restarts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="relative">
      <SearchIcon
        width={14}
        height={14}
        className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="search"
        data-testid="inbox-search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft('');
            onChange('');
            e.currentTarget.blur();
          }
        }}
        className="h-9 w-full rounded-md border border-border bg-muted/40 ps-8 pe-3 text-sm outline-none focus:bg-background focus-visible:ring-2 focus-visible:ring-primary"
      />
    </div>
  );
}

function TabBar({
  id,
  controls,
  value,
  list,
  onChange,
}: {
  id: string;
  controls: string;
  value: InboxTab;
  list: ListState;
  onChange: (tab: InboxTab) => void;
}) {
  const t = useTranslations('team-inbox-conversations.list');
  const onKey = (e: KeyboardEvent, index: number) => {
    const last = INBOX_TABS.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % INBOX_TABS.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + INBOX_TABS.length) % INBOX_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const tab = INBOX_TABS[next]!;
    onChange(tab);
    document.getElementById(`${id}-${tab}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('tabsLabel')}
      className="flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {INBOX_TABS.map((tab, i) => {
        const n = tabCount(list.counts, tab);
        const selected = tab === value;
        return (
          <button
            key={tab}
            id={`${id}-${tab}`}
            role="tab"
            type="button"
            data-testid={`inbox-tab-${tab}`}
            aria-selected={selected}
            aria-controls={controls}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'flex min-w-fit flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-primary',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{t(`tabs.${tab}`)}</span>
            {n !== null && n > 0 && (
              <span
                data-testid={`inbox-tab-count-${tab}`}
                className={cn(
                  'rounded-full px-1.5 text-[10px] tabular-nums',
                  tab === 'unread'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-border text-foreground',
                )}
              >
                {n > 999 ? '999+' : n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The end of the list: loads the next page by itself when scrolled into view, with a button as the fallback and for a failure. */
function LoadMore({ onLoad, failed }: { onLoad: () => void; failed: boolean }) {
  const t = useTranslations('team-inbox-conversations.list');
  const ref = useRef<HTMLDivElement>(null);
  const load = useRef(onLoad);
  useEffect(() => {
    load.current = onLoad;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [failed]);
  return (
    <div ref={ref} className="flex flex-col items-center gap-2 p-3">
      {failed && (
        <p role="alert" className="text-xs text-danger">
          {t('moreFailed')}
        </p>
      )}
      <Button variant="secondary" size="sm" onClick={onLoad}>
        {t('loadMore')}
      </Button>
    </div>
  );
}
