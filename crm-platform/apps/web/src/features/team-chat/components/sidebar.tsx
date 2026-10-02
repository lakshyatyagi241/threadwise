'use client';

import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@crm/ui';
import type { TchatChannelResponse } from '@crm/contracts';
import { HashIcon, LockIcon, PlusIcon, UsersIcon } from './icons';
import { Avatar } from './parts';

export interface SidebarProps {
  channels: TchatChannelResponse[];
  activeId: string | null;
  loading: boolean;
  failed: boolean;
  canCreate: boolean;
  pendingCount: number;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onInvite: () => void;
  onPending: () => void;
}

/** The left column: channels with unread badges, direct messages, and the invitation entry points. */
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
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active ? 'bg-primary/10 font-medium' : 'hover:bg-muted',
          )}
        >
          {c.type === 'dm' && c.peer ? (
            <Avatar id={c.peer.id} name={c.peer.name} size="sm" />
          ) : c.type === 'private' ? (
            <LockIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <HashIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {c.unread > 0 && (
            <Badge tone="warning" aria-label={t('unread', { count: c.unread })}>
              {c.unread}
            </Badge>
          )}
        </button>
      </li>
    );
  };

  return (
    <nav aria-label={t('label')} className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <section aria-labelledby="tchat-channels-h">
        <div className="mb-1 flex items-center justify-between px-1">
          <h2
            id="tchat-channels-h"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t('channels')}
          </h2>
          {props.canCreate && (
            <button
              type="button"
              aria-label={t('createChannel')}
              onClick={props.onCreate}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PlusIcon />
            </button>
          )}
        </div>
        {props.loading ? (
          <p role="status" className="px-2 text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : props.failed ? (
          <p role="alert" className="px-2 text-sm text-danger">
            {t('loadFailed')}
          </p>
        ) : rooms.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">{t('noChannels')}</p>
        ) : (
          <ul className="space-y-0.5">{rooms.map(row)}</ul>
        )}
      </section>

      {directs.length > 0 && (
        <section aria-labelledby="tchat-dms-h">
          <h2
            id="tchat-dms-h"
            className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t('direct')}
          </h2>
          <ul className="space-y-0.5">{directs.map(row)}</ul>
        </section>
      )}

      <section aria-labelledby="tchat-people-h" className="mt-auto">
        <div className="mb-1 flex items-center justify-between px-1">
          <h2
            id="tchat-people-h"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {t('people')}
          </h2>
          <button
            type="button"
            aria-label={t('invite')}
            onClick={props.onInvite}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PlusIcon />
          </button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-between"
          onClick={props.onPending}
        >
          <span className="flex items-center gap-2">
            <UsersIcon />
            {t('pending')}
          </span>
          {props.pendingCount > 0 && (
            <Badge tone="warning" aria-label={t('pendingCount', { count: props.pendingCount })}>
              {props.pendingCount}
            </Badge>
          )}
        </Button>
      </section>
    </nav>
  );
}
