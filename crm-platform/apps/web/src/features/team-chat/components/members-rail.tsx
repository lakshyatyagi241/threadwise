'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Input, cn } from '@crm/ui';
import type { TchatMember } from '@crm/contracts';
import { MessageIcon } from './icons';
import { Avatar } from './parts';

export interface MembersRailProps {
  members: TchatMember[] | null;
  meId: string;
  online: ReadonlySet<string>;
  onMention: (member: TchatMember) => void;
  onDirect: (member: TchatMember) => void;
}

/** The second column: everyone in the workspace, a filter, who is online; a click mentions, the icon opens a direct message. */
export function MembersRail({ members, meId, online, onMention, onDirect }: MembersRailProps) {
  const t = useTranslations('team-chat.members');
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (members ?? []).filter(
      (m) =>
        !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
    );
  }, [members, q]);

  return (
    <aside aria-label={t('label')} className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div>
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">
          {members ? t('count', { count: members.length }) : t('countUnknown')}
        </p>
      </div>
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        className="h-9"
      />
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {members === null && <li className="px-2 text-sm text-muted-foreground">{t('loading')}</li>}
        {members !== null && shown.length === 0 && (
          <li className="px-2 text-sm text-muted-foreground">{t('none')}</li>
        )}
        {shown.map((m) => {
          const self = m.id === meId;
          return (
            <li key={m.id} className="group flex items-center gap-1 rounded-md hover:bg-muted">
              <button
                type="button"
                disabled={self}
                onClick={() => onMention(m)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-start text-sm disabled:cursor-default"
              >
                <span className="relative">
                  <Avatar id={m.id} name={m.name} size="sm" />
                  <span
                    role="img"
                    aria-label={online.has(m.id) ? t('online') : t('offline')}
                    className={cn(
                      'absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-background',
                      online.has(m.id) ? 'bg-success' : 'bg-border',
                    )}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {m.name}
                    {self && (
                      <span className="ms-1 font-normal text-muted-foreground">{t('you')}</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
              </button>
              {!self && (
                <button
                  type="button"
                  aria-label={t('message', { name: m.name })}
                  onClick={() => onDirect(m)}
                  className="me-1 rounded p-1.5 text-muted-foreground hover:bg-border hover:text-foreground"
                >
                  <MessageIcon />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
