'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Popover, cn } from '@crm/ui';
import { AddonLockLink } from '@/features/plans-subscriptions-trials/components/addon-lock';
import { useOptionalSession } from '@/features/auth-registration-security/shared/session-context';
import { useMyAvailability } from '../api/hooks';
import { formatDay } from '../lib/leave';
import { nextManualStatus, showsOutsideHoursNotice, statusView } from '../lib/agent-status';
import { MyLeaveDialog, useMyLeave } from './my-leave-row';
import { WorkingHoursDialog } from './working-hours-dialog';

const DOT = {
  available: 'bg-success',
  away: 'bg-muted-foreground/60',
  leave: 'bg-warning',
} as const;

const ITEM =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

const SECTION =
  'px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground';

/**
 * The status pill and its menu (docs/specs/agent-status-bar.md): a dot and the word (Available, Away, On leave until <date>, Away outside
 * working hours) in the global top bar and at the top of the Inbox sidebar. The menu: the person's name; "Update status" (Set as away or
 * Set as available: a manual choice that beats leave and the schedule); "Automate status" -> "Manage working hours and out of office",
 * which opens the personal working hours dialog and the Time off dialog. Both places read the same query, so they never disagree.
 *
 * Plan: the pill is `agent_status_bar`. Without it the pill still tells the truth but the menu is a locked note naming what unlocks it
 * with the way to Plans (never hidden); the account menu's Available / Away switch stays for everyone. Drawn nothing when the status
 * cannot be read (an operator session).
 */
export function AgentStatusMenu({ variant }: { variant: 'topbar' | 'inbox' }) {
  const t = useTranslations('workspaces-teams-tenancy.status');
  const locale = useLocale();
  const session = useOptionalSession();
  const { query, set } = useMyAvailability();
  const leave = useMyLeave();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const data = query.data;
  if (!data) return null;

  const view = statusView(data);
  const word =
    view.word === 'onLeaveUntil' && view.leaveUntil
      ? t('pill.onLeaveUntil', { date: formatDay(view.leaveUntil, locale, true) })
      : t(`pill.${view.word}`);
  const entitled = data.features.bar;
  const close = () => setOpen(false);

  return (
    <div
      className={cn('relative', variant === 'inbox' ? 'border-b border-border px-3 py-2' : '')}
      data-testid={`agent-status-${variant}`}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('pill.label')}: ${word}`}
        title={t('pill.label')}
        data-testid={`agent-status-pill-${variant}`}
        data-state={view.tone}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[12.5px] font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          variant === 'topbar' && 'max-w-[11rem] sm:max-w-[16rem]',
        )}
      >
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[view.tone])} />
        <span className="truncate">{word}</span>
      </button>

      {showsOutsideHoursNotice(data) && (
        <p
          className="mt-1.5 text-[11.5px] text-muted-foreground"
          data-testid="agent-status-outside-hours"
        >
          {t('menu.outsideNotice')}
        </p>
      )}

      <Popover
        open={open}
        onClose={close}
        label={t('menu.title')}
        className="w-[280px] space-y-0 overflow-hidden rounded-2xl p-0"
      >
        <div className="truncate px-4 pb-1 pt-3 text-sm font-semibold">
          {session?.user.fullName ?? ''}
        </div>

        {!entitled ? (
          <div
            className="px-4 pb-4 pt-1 text-[13px] text-muted-foreground"
            data-testid="agent-status-locked"
          >
            <p>{t('menu.locked')}</p>
            <p className="mt-1">
              <AddonLockLink />
            </p>
            {data.features.automation && (
              <button
                type="button"
                role="menuitem"
                data-testid="agent-status-hours"
                className={cn(ITEM, '-mx-3 mt-2 w-[calc(100%+1.5rem)]')}
                onClick={() => {
                  close();
                  setHoursOpen(true);
                }}
              >
                {t('menu.workingHours')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={SECTION}>{t('menu.update')}</div>
            <div className="px-1.5">
              <button
                type="button"
                role="menuitem"
                disabled={set.isPending}
                data-testid="agent-status-toggle"
                className={ITEM}
                onClick={() => {
                  set.mutate(nextManualStatus(data));
                  close();
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    nextManualStatus(data) === 'online' ? DOT.available : DOT.away,
                  )}
                />
                {nextManualStatus(data) === 'online' ? t('menu.setAvailable') : t('menu.setAway')}
              </button>
              {set.isError && (
                <p className="px-3 pb-1 text-xs text-danger" role="alert">
                  {t('menu.failed')}
                </p>
              )}
            </div>

            <div className={SECTION}>{t('menu.automate')}</div>
            <div className="px-1.5 pb-1.5">
              <button
                type="button"
                role="menuitem"
                aria-expanded={expanded}
                data-testid="agent-status-manage"
                className={ITEM}
                onClick={() => setExpanded((v) => !v)}
              >
                <span className="flex-1">{t('menu.manage')}</span>
                <span aria-hidden="true" className="text-muted-foreground">
                  {expanded ? '–' : '+'}
                </span>
              </button>
              {expanded && (
                <div className="ms-3 border-s border-border ps-1">
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="agent-status-hours"
                    className={ITEM}
                    onClick={() => {
                      close();
                      setHoursOpen(true);
                    }}
                  >
                    {t('menu.workingHours')}
                  </button>
                  {leave.allowed && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="agent-status-timeoff"
                      className={ITEM}
                      onClick={() => {
                        close();
                        setLeaveOpen(true);
                      }}
                    >
                      {t('menu.timeOff')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Popover>

      {/* Outside the popover: closing the menu must not close the dialogs it opened. */}
      {hoursOpen && <WorkingHoursDialog memberId="me" open onClose={() => setHoursOpen(false)} />}
      {leaveOpen && <MyLeaveDialog open onClose={() => setLeaveOpen(false)} />}
    </div>
  );
}
