'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@crm/ui';
import type { TchatChannelResponse } from '@crm/contracts';
import { ChatBubbleIcon, ClockIcon, GridIcon, LockIcon, PlusIcon, UsersIcon } from './icons';
import { Avatar } from './parts';

export interface SidebarProps {
  channels: TchatChannelResponse[];
  activeId: string | null;
  loading: boolean;
  failed: boolean;
  workspaceName: string;
  pendingCount: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onInvite: () => void;
  onPending: () => void;
}

const eyebrow = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const navBtn = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-full px-2.5 py-1.5 text-start text-[13px]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    active
      ? 'bg-primary font-medium text-primary-foreground'
      : 'text-foreground/80 hover:bg-muted hover:text-foreground',
  );
const miniAdd =
  'grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground';

/**
 * The left column (Reference's 200 px nav): workspace name, the Mode switch, channels with unread pills, direct messages, and the
 * people entries (Members, Pending requests). The add buttons show to everyone, as in Reference; the server decides.
 */
export function Sidebar(props: SidebarProps) {
  const t = useTranslations('team-chat.sidebar');
  const rooms = props.channels.filter((c) => c.type !== 'dm');
  const directs = props.channels.filter((c) => c.type === 'dm');

  const row = (c: TchatChannelResponse) => {
    const active = c.id === props.activeId;
    const title = c.type === 'dm' ? (c.peer?.name ?? c.name) : c.name;
    return (
      <li key={c.id}>
        <button
          type="button"
          data-testid="tchat-channel"
          aria-current={active ? 'true' : undefined}
          onClick={() => props.onSelect(c.id)}
          className={navBtn(active)}
        >
          {c.type === 'dm' && c.peer ? (
            <Avatar id={c.peer.id} name={c.peer.name} size="sm" />
          ) : c.type === 'private' ? (
            <LockIcon className="size-3.5 shrink-0" />
          ) : (
            <span
              aria-hidden="true"
              className={cn('font-mono', !active && 'text-muted-foreground')}
            >
              #
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {c.unread > 0 && (
            <span
              aria-label={t('unread', { count: c.unread })}
              className={cn(
                'animate-pulse rounded-full px-1.5 py-px font-mono text-[10px]',
                active ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
              )}
            >
              {c.unread}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label={t('label')} className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className={cn(eyebrow, 'px-1')}>{t('workspace')}</div>
        <div className="mt-0.5 truncate px-1 font-serif text-base leading-tight">
          {props.workspaceName}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        <div className={cn(eyebrow, 'px-2 pb-1 pt-2')}>{t('mode')}</div>
        <Link href="/inbox" className={navBtn(false)}>
          <GridIcon />
          {t('customerChats')}
        </Link>
        <button type="button" aria-current="page" className={navBtn(true)}>
          <ChatBubbleIcon />
          {t('teamChat')}
        </button>

        <section aria-labelledby="tchat-channels-h">
          <div className="flex items-center justify-between px-2 pb-1 pt-3">
            <h2 id="tchat-channels-h" className={eyebrow}>
              {t('channels')}
            </h2>
            <button
              type="button"
              title={t('createChannel')}
              aria-label={t('createChannel')}
              onClick={props.onCreate}
              className={miniAdd}
            >
              <PlusIcon className="size-3" />
            </button>
          </div>
          {props.loading ? (
            <p role="status" className="px-2 text-[11px] text-muted-foreground">
              {t('loading')}
            </p>
          ) : props.failed ? (
            <p role="alert" className="px-2 text-[11px] text-danger">
              {t('loadFailed')}
            </p>
          ) : rooms.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">{t('noChannels')}</p>
          ) : (
            <ul className="space-y-0.5">{rooms.map(row)}</ul>
          )}
        </section>

        {directs.length > 0 && (
          <section aria-labelledby="tchat-dms-h">
            <h2 id="tchat-dms-h" className={cn(eyebrow, 'px-2 pb-1 pt-3')}>
              {t('direct')}
            </h2>
            <ul className="space-y-0.5">{directs.map(row)}</ul>
          </section>
        )}

        <section aria-labelledby="tchat-people-h">
          <div className="flex items-center justify-between px-2 pb-1 pt-3">
            <h2 id="tchat-people-h" className={eyebrow}>
              {t('people')}
            </h2>
            <button
              type="button"
              title={t('invite')}
              aria-label={t('invite')}
              onClick={props.onInvite}
              className={miniAdd}
            >
              <PlusIcon className="size-3" />
            </button>
          </div>
          <Link href="/team-members" className={navBtn(false)}>
            <UsersIcon />
            {t('membersLink')}
          </Link>
          <button type="button" className={navBtn(false)} onClick={props.onPending}>
            <ClockIcon />
            <span className="flex-1 text-start">{t('pending')}</span>
            {props.pendingCount > 0 && (
              <span
                aria-label={t('pendingCount', { count: props.pendingCount })}
                className="rounded-full bg-muted-foreground/15 px-1.5 py-px font-mono text-[10px]"
              >
                {props.pendingCount}
              </span>
            )}
          </button>
        </section>
      </div>
    </nav>
  );
}
