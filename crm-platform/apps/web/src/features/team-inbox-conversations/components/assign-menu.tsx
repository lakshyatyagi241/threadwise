'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Popover } from '@crm/ui';
import { useAssignees } from '../api/hooks';

export interface AssignMenuProps {
  /** Who has the conversation now (null: nobody). */
  current: { id: string; name: string | null } | null;
  meId: string;
  /** May hand the conversation to anyone (else only claim it for oneself). */
  canAssign: boolean;
  busy: boolean;
  onAssign: (change: { userId: string | null }) => void;
}

/**
 * The thread header's assign control: a pill that names who has the chat ("Assign" while nobody does) and opens the list of
 * teammates (with "Assign to me" and "Unassign"). Picking one hands the chat over at once.
 */
export function AssignMenu({ current, meId, canAssign, busy, onAssign }: AssignMenuProps) {
  const t = useTranslations('team-inbox-conversations.panel.assignee');
  const tb = useTranslations('team-inbox-conversations.bulk');
  const [open, setOpen] = useState(false);
  const assignees = useAssignees(open && canAssign);
  const users = assignees.data?.users ?? [];
  const pick = (userId: string | null) => {
    setOpen(false);
    onAssign({ userId });
  };
  const row =
    'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="inbox-assign-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 max-w-44 items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c.4-2.4 2.4-3.7 5-3.7s4.6 1.3 5 3.7" />
        </svg>
        <span className="truncate">{current ? (current.name ?? t('unknown')) : tb('assign')}</span>
        <svg
          viewBox="0 0 16 16"
          className="size-3.5 shrink-0 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6.5 8 10l4-3.5" />
        </svg>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('pick')}
        className="end-0 start-auto mt-1 w-64"
      >
        <div role="menu" className="max-h-72 space-y-0.5 overflow-y-auto">
          {current?.id !== meId && (
            <button type="button" role="menuitem" className={row} onClick={() => pick(meId)}>
              {t('assignToMe')}
            </button>
          )}
          {canAssign &&
            users
              .filter((u) => u.id !== meId)
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  role="menuitem"
                  className={row}
                  aria-current={u.id === current?.id ? 'true' : undefined}
                  onClick={() => pick(u.id)}
                >
                  <span className="truncate">{u.name ?? u.email}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('open', { count: u.openConversations })}
                  </span>
                </button>
              ))}
          {canAssign && assignees.isError && (
            <p role="alert" className="px-2.5 py-1.5 text-xs text-danger">
              {t('loadFailed')}
            </p>
          )}
          {current && canAssign && (
            <button
              type="button"
              role="menuitem"
              className={`${row} text-muted-foreground`}
              onClick={() => pick(null)}
            >
              {t('unassign')}
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}
