'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@crm/ui';
import type { InboxConversationDetail } from '@crm/contracts';
import { inboxApi } from '../api/service';

type Past = InboxConversationDetail['pastConversations'][number];

/** How many closed cards show at first; the rest open with "Show more". */
const SHOWN = 3;
/** The most of an earlier thread that its card reads out (the thread itself opens in full). */
const MESSAGES = 6;
const BODY_CHARS = 500;

/**
 * Above an email conversation: the same customer's earlier mail threads as closed cards (subject, the day it began, its status). A click
 * opens a card and reads the thread out under it, so several threads can be compared without leaving the one being answered; "Open
 * thread" moves the screen to it.
 */
export function EarlierThreads({
  items,
  onOpen,
}: {
  items: InboxConversationDetail['pastConversations'];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('team-inbox-conversations.earlier');
  const mail = items.filter((p) => p.channel.kind === 'email');
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (mail.length === 0) return null;
  const shown = all ? mail : mail.slice(0, SHOWN);
  return (
    <section
      aria-label={t('title')}
      data-testid="inbox-earlier-threads"
      className="max-h-[40vh] overflow-y-auto border-b border-border bg-muted/30 px-3 py-2"
    >
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">
        {t('title')} <span className="font-normal">({mail.length})</span>
      </h3>
      <ul className="space-y-1.5">
        {shown.map((p) => (
          <ThreadCard
            key={p.id}
            item={p}
            open={open === p.id}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
            onOpen={() => onOpen(p.id)}
          />
        ))}
      </ul>
      {mail.length > SHOWN && (
        <button
          type="button"
          data-testid="inbox-earlier-more"
          onClick={() => setAll((v) => !v)}
          className="mt-1.5 w-full rounded-md py-1 text-center text-xs font-medium text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {all ? t('showLess') : t('showMore', { count: mail.length - SHOWN })}
        </button>
      )}
    </section>
  );
}

function ThreadCard({
  item,
  open,
  onToggle,
  onOpen,
}: {
  item: Past;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations('team-inbox-conversations.earlier');
  const ts = useTranslations('team-inbox-conversations.panel.past.status');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(new Date(iso));
  const body = useQuery({
    queryKey: ['inbox', 'earlier-thread', item.id],
    queryFn: ({ signal }) => inboxApi.messages(item.id, { limit: MESSAGES }, signal),
    enabled: open,
    staleTime: 30_000,
  });
  const panel = `earlier-${item.id}`;
  return (
    <li className="rounded-lg border border-border bg-background shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        data-testid="inbox-earlier-card"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          <span className="block text-[11px] text-muted-foreground">
            {t('began', { date: day(item.createdAt) })}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
            item.status === 'open'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {ts(item.status)}
        </span>
        <svg
          viewBox="0 0 16 16"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition', open && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6.5 8 10l4-3.5" />
        </svg>
      </button>
      {open && (
        <div id={panel} className="space-y-2 border-t border-border px-3 py-2">
          {body.isPending && <p className="text-xs text-muted-foreground">{t('loading')}</p>}
          {body.isError && <p className="text-xs text-danger">{t('failed')}</p>}
          {body.data?.data.map((m) => (
            <article key={m.id} className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {m.email?.from.name || m.email?.from.address || m.sender.name || t('unknown')}
                </span>
                {' · '}
                {day(m.createdAt)}
              </p>
              <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                {(m.body ?? '').slice(0, BODY_CHARS)}
                {(m.body ?? '').length > BODY_CHARS ? '…' : ''}
              </p>
            </article>
          ))}
          <button
            type="button"
            data-testid="inbox-earlier-open"
            onClick={onOpen}
            className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('openThread')}
          </button>
        </div>
      )}
    </li>
  );
}
