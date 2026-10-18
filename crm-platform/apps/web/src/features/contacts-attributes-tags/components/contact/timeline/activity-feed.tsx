'use client';

import { useState } from 'react';
import { useTimeZone, useTranslations } from 'next-intl';
import { Button, Spinner, cn } from '@crm/ui';
import { AGENT_IGNORE } from '@/lib/agent-marks';
import type { ContactRow } from '../../../api/schemas';
import { useDebounced } from '../../../lib/use-debounced';
import {
  TIMELINE_FILTERS,
  groupByDay,
  type TimelineEntry,
  type TimelineFilter,
} from '../../../lib/timeline';
import { SearchIcon, XIcon } from '../../icons';
import { ErrorLine } from '../../error-line';
import { useRefreshContact } from '../shared';
import { TimelineRow } from './timeline-row';
import { useTimelineFeed } from './use-timeline-feed';
import { useComposeTabs, type ComposeTab } from './compose-box';

function Heading({ children }: { children: string }) {
  return (
    <h3 className="mb-0.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </h3>
  );
}

function List({
  entries,
  contact,
  onChanged,
}: {
  entries: readonly TimelineEntry[];
  contact: ContactRow;
  onChanged: () => void;
}) {
  return (
    <ul className="divide-y divide-border/60" {...AGENT_IGNORE}>
      {entries.map((e) => (
        <TimelineRow key={e.id} entry={e} contact={contact} onChanged={onChanged} />
      ))}
    </ul>
  );
}

/**
 * The contact's history, newest first, under the compose box: "Up next" (open tasks and meetings still to come), then Today,
 * Yesterday, This week and Earlier. Filter pills (All, Messages, Calls, Notes, Tasks, Meetings, Changes), a search box over what is
 * loaded, compact entries and "Load more". `bare` (the Overview) leaves out the pills and the search. The card stretches to the bottom of the
 * column, so a short history never leaves a blank page under it.
 */
export function ActivityFeed({
  contact,
  bare,
  onCompose,
}: {
  contact: ContactRow;
  /** The Overview's timeline: the same history without the filter pills and the search box. */
  bare?: boolean;
  /** The empty state's actions: open that tab of the compose box. */
  onCompose?: (tab: ComposeTab) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.timeline');
  const timeZone = useTimeZone();
  const refresh = useRefreshContact(contact.id);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 200);
  const feed = useTimelineFeed(contact, bare ? 'all' : filter, bare ? '' : query);

  const now = new Date();
  const buckets = groupByDay(feed.dated, now, timeZone);
  const upNext = feed.upNext;
  const nothing = feed.dated.length === 0 && feed.upNext.length === 0;
  const filtering = filter !== 'all' || query !== '';

  const toolbar = !bare && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-1.5">
        {TIMELINE_FILTERS.map((f) => {
          const on = f === filter;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f)}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
                on
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`filters.${f}`)}
            </button>
          );
        })}
      </div>
      <div className="relative min-w-40 flex-1 sm:max-w-64">
        <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
        />
        {text !== '' && (
          <button
            type="button"
            onClick={() => setText('')}
            aria-label={t('clearSearch')}
            className="absolute end-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  let body;
  if (feed.loading && nothing) {
    body = (
      <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  } else if (feed.failed) {
    body = <ErrorLine error={feed.error} onRetry={feed.retry} />;
  } else if (feed.empty && !filtering) {
    body = <EmptyFeed contact={contact} onCompose={onCompose} />;
  } else if (nothing && !feed.canLoadMore) {
    body = (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <p>{filtering ? t('noMatch') : t('emptyShort')}</p>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setFilter('all');
              setText('');
            }}
            className="mt-1 rounded text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('showAll')}
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <div>
        {upNext.length > 0 && (
          <section aria-label={t('groups.upNext')}>
            <Heading>{t('groups.upNext')}</Heading>
            <List entries={upNext} contact={contact} onChanged={() => void refresh()} />
          </section>
        )}
        {buckets.map((b) => (
          <section key={b.group} aria-label={t(`groups.${b.group}`)}>
            <Heading>{t(`groups.${b.group}`)}</Heading>
            <List entries={b.entries} contact={contact} onChanged={() => void refresh()} />
          </section>
        ))}
        {nothing && feed.canLoadMore && (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('noneYet')}</p>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label={t('title')}
      className="flex min-h-48 flex-1 flex-col space-y-3 rounded-xl border border-border bg-background p-3 sm:p-4"
    >
      <h2 className="sr-only">{t('title')}</h2>
      {toolbar}
      {feed.partial && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          {t('partial')}
          <button
            type="button"
            onClick={feed.retry}
            className="font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('retry')}
          </button>
        </p>
      )}
      {query !== '' && feed.canLoadMore && (
        <p className="text-xs text-muted-foreground">{t('searchHint')}</p>
      )}
      {body}
      {feed.canLoadMore && !feed.failed && (
        <div className="flex justify-center pt-1">
          <Button variant="secondary" size="sm" disabled={feed.loadingMore} onClick={feed.loadMore}>
            {feed.loadingMore && <Spinner />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Nothing has happened with this contact yet: say so kindly and offer the most useful first steps (the compose box's tabs). */
function EmptyFeed({
  contact,
  onCompose,
}: {
  contact: ContactRow;
  onCompose?: (tab: ComposeTab) => void;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.timeline.empty');
  const first = contact.firstName?.trim() || contact.name?.trim() || '';
  const available = useComposeTabs();
  // The three most useful first steps this person can take, in this order: a note, a call (or a task), a meeting (or a task).
  const order: ComposeTab[] = ['note', 'call', 'task', 'meeting'];
  const actions: Array<{ tab: ComposeTab; label: string }> = onCompose
    ? order
        .filter((tab) => available.includes(tab))
        .slice(0, 3)
        .map((tab) => ({ tab, label: t(tab) }))
    : [];
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <p className="text-base font-semibold">{t('title')}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground" dir="auto">
        {first ? t('message', { name: first }) : t('messageNoName')}
      </p>
      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a) => (
            <Button key={a.tab} variant="secondary" size="sm" onClick={() => onCompose?.(a.tab)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
