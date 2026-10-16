'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { MessageResponse } from '@crm/contracts';
import { CloseIcon, SearchIcon } from './icons';
import { jumpToMessage } from './quote-preview';

/** The ids of the messages whose text has `needle` in it, oldest first (a search with no text matches nothing). */
export function matchingMessages(messages: MessageResponse[], needle: string): string[] {
  const n = needle.trim().toLowerCase();
  if (n === '') return [];
  return messages.filter((m) => (m.body ?? '').toLowerCase().includes(n)).map((m) => m.id);
}

/**
 * Search inside the open conversation: the thread header turns into one wide box with the number of matches and arrows to move
 * between them (the newest match first; Enter goes to the next older one, Shift+Enter back). It looks in the messages already
 * loaded in the thread. Escape or the cross puts the header back.
 */
export function ThreadSearch(props: {
  messages: MessageResponse[];
  onClose: () => void;
  className?: string;
}) {
  const t = useTranslations('team-inbox-conversations.thread');
  const [q, setQ] = useState('');
  const hits = useMemo(() => matchingMessages(props.messages, q), [props.messages, q]);
  // Counted from the newest: 0 is the latest match.
  // It restarts at the newest match whenever the text changes, so it is remembered with the text it belongs to.
  const [pos, setPos] = useState({ q: '', i: 0 });
  const at = pos.q === q ? pos.i : 0;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const target =
    hits.length > 0 ? hits[hits.length - 1 - Math.min(at, hits.length - 1)] : undefined;
  useEffect(() => {
    if (target) jumpToMessage(target);
  }, [target]);

  const step = (by: number) => {
    if (hits.length === 0) return;
    setPos({ q, i: (Math.min(at, hits.length - 1) + by + hits.length) % hits.length });
    if (hits.length === 1 && target) jumpToMessage(target);
  };
  const btn =
    'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40';

  return (
    <div
      role="search"
      data-testid="inbox-thread-search"
      className={cn(
        'flex h-9 items-center gap-1 rounded-full border border-primary bg-background ps-3 pe-1',
        props.className,
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        type="search"
        data-testid="inbox-thread-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            props.onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
        }}
        aria-label={t('searchPlaceholder')}
        placeholder={t('searchPlaceholder')}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      {q.trim() !== '' && (
        <span
          role="status"
          className="shrink-0 whitespace-nowrap px-1 text-xs text-muted-foreground"
        >
          {hits.length === 0
            ? t('searchNone')
            : t('searchCount', { current: Math.min(at, hits.length - 1) + 1, total: hits.length })}
        </span>
      )}
      <button
        type="button"
        aria-label={t('searchPrev')}
        title={t('searchPrev')}
        disabled={hits.length < 2}
        onClick={() => step(1)}
        className={btn}
      >
        <span aria-hidden="true">↑</span>
      </button>
      <button
        type="button"
        aria-label={t('searchNext')}
        title={t('searchNext')}
        disabled={hits.length < 2}
        onClick={() => step(-1)}
        className={btn}
      >
        <span aria-hidden="true">↓</span>
      </button>
      <button
        type="button"
        data-testid="inbox-thread-search-close"
        aria-label={t('searchClose')}
        title={t('searchClose')}
        onClick={props.onClose}
        className={btn}
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
