'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@crm/ui';
import type { TchatMember } from '@crm/contracts';
import { MessageIcon, SearchIcon } from './icons';
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
    <aside aria-label={t('label')} className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 space-y-2 border-b border-border px-3 pb-2 pt-3">
        <h2 className="font-serif text-[18px] leading-tight">
          {t('title')} <span className="italic text-primary">{t('titleAccent')}</span>
        </h2>
        <p className="text-[11.5px] text-muted-foreground">
          {members ? t('count', { count: members.length }) : t('countUnknown')}
        </p>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="w-full rounded-md border border-border bg-muted/40 py-1.5 pe-3 ps-8 text-[12.5px] outline-none focus:border-primary focus:bg-background"
          />
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {members === null && (
          <li className="py-4 text-center font-mono text-[11px] text-muted-foreground">
            {t('loading')}
          </li>
        )}
        {members !== null && shown.length === 0 && (
          <li className="py-4 text-center font-mono text-[11px] text-muted-foreground">
            {t('none')}
          </li>
        )}
        {shown.map((m) => {
          const self = m.id === meId;
          return (
            <li
              key={m.id}
              className="group flex items-center border-b border-border/60 hover:bg-muted"
            >
              <button
                type="button"
                disabled={self}
                onClick={() => onMention(m)}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-start disabled:cursor-default"
              >
                <span className="relative">
                  <Avatar id={m.id} name={m.name} size="md" />
                  <span
                    role="img"
                    aria-label={online.has(m.id) ? t('online') : t('offline')}
                    className={cn(
                      'absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-background',
                      online.has(m.id) ? 'bg-success' : 'bg-border',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">
                    {m.name}
                    {self && (
                      <span className="ms-1 font-mono text-[10px] font-normal text-muted-foreground">
                        {t('you')}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {m.email}
                  </span>
                </span>
              </button>
              {!self && (
                <button
                  type="button"
                  aria-label={t('message', { name: m.name })}
                  onClick={() => onDirect(m)}
                  className="me-2 rounded p-1.5 text-muted-foreground opacity-0 hover:bg-border hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
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
