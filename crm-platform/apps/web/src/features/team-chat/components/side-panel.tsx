'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input, Spinner } from '@crm/ui';
import type { TchatMessageResponse } from '@crm/contracts';
import { KEYS } from '../api/hooks';
import { chatApi } from '../api/service';
import { plainBody } from '../lib/body';
import { formatStamp } from '../lib/format';
import { CloseIcon } from './icons';
import { useNow } from './parts';

/** Search results or the pinned messages of one channel, in a strip under the header. */
export function SidePanel({
  mode,
  channelId,
  onClose,
  onJump,
}: {
  mode: 'search' | 'pinned';
  channelId: string;
  onClose: () => void;
  onJump: (m: TchatMessageResponse) => void;
}) {
  const t = useTranslations('team-chat.panel');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const now = useNow();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');

  // The search runs 300 ms after typing stops, and only for two characters or more (the API's rule).
  useEffect(() => {
    const id = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const search = useQuery({
    queryKey: ['team-chat', 'search', channelId, applied],
    queryFn: ({ signal }) => chatApi.search(channelId, applied, signal),
    enabled: mode === 'search' && applied.length >= 2,
    retry: false,
  });
  const pinned = useQuery({
    queryKey: KEYS.pinned(channelId),
    queryFn: ({ signal }) => chatApi.pinned(channelId, signal),
    enabled: mode === 'pinned',
    retry: false,
  });
  const q2 = mode === 'search' ? search : pinned;
  const rows = q2.data?.data ?? [];

  return (
    <section
      aria-label={mode === 'search' ? t('searchTitle') : t('pinnedTitle')}
      className="max-h-56 shrink-0 space-y-2 overflow-y-auto border-b border-border bg-muted/40 px-4 py-2"
    >
      <div className="flex items-center gap-2">
        {mode === 'search' ? (
          <Input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchTitle')}
            className="h-8"
          />
        ) : (
          <h3 className="flex-1 text-sm font-semibold">{t('pinnedTitle')}</h3>
        )}
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-border"
        >
          <CloseIcon />
        </button>
      </div>
      {q2.isFetching && <Spinner />}
      {mode === 'search' && applied.length < 2 && (
        <p className="text-xs text-muted-foreground">{t('searchHint')}</p>
      )}
      {q2.isError && (
        <p role="alert" className="text-xs text-danger">
          {t('failed')}
        </p>
      )}
      {!q2.isFetching && q2.data && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {mode === 'search' ? t('noResults') : t('noPinned')}
        </p>
      )}
      <ul className="space-y-1">
        {rows.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onJump(m)}
              className="w-full rounded-md bg-background px-2 py-1.5 text-start text-xs hover:bg-border/60"
            >
              <span className="font-medium">{m.authorName}</span>{' '}
              <span className="text-muted-foreground">
                {formatStamp(m.createdAt, now, locale, timeZone)}
              </span>
              <span className="block truncate">
                {plainBody(m.body ?? m.attachment?.name ?? '')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
