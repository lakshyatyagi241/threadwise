'use client';

import { cn } from '@crm/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useOptionalSession } from '@/features/auth-registration-security/shared/session-context';
import { NavIcon } from '@/components/shell/nav-icons';
import { useMembersSummary } from '../api/hooks';
import { useLeaveOverview } from '../api/leave';
import { formatDay } from '../lib/leave';
import { MemberLeaveDialog } from './member-leave-dialog';

/** The permission that lets a person set their own leave. Every preset role has it (scope `own` for Agent and Viewer). */
export const MY_LEAVE_PERMISSION = 'team.leave.manage';

/**
 * Who the account menu's "Time off" row is for, and what to say on it. It needs only `team.leave.manage`: the member id comes from the
 * members summary and the leave panel from `team.leave.read`, and neither needs `team.read` (the Team settings tile), so a Viewer or a
 * custom role without Team access can still tell the team they are away. Nothing is drawn outside a workspace session.
 */
export function useMyLeave() {
  const session = useOptionalSession();
  const allowed = session ? MY_LEAVE_PERMISSION in session.permissions : false;
  const summary = useMembersSummary();
  const memberId = allowed ? (summary.data?.me.id ?? null) : null;
  const overview = useLeaveOverview(memberId);
  return { allowed: allowed && memberId !== null, memberId, overview: overview.data ?? null };
}

/** "Time off" row of the account menu: shows "On leave until <date>" while away, and opens the leave dialog for yourself. */
export function MyLeaveRow({ className, onOpen }: { className?: string; onOpen: () => void }) {
  const t = useTranslations('workspaces-teams-tenancy.myLeave');
  const locale = useLocale();
  const { allowed, overview } = useMyLeave();
  if (!allowed) return null;
  const current = overview?.current ?? null;
  const status = current
    ? current.endsOn
      ? t('onLeaveUntil', { date: formatDay(current.endsOn, locale, true) })
      : t('onLeaveOpen')
    : null;
  return (
    <button
      type="button"
      title={t('hint')}
      data-testid="user-menu-leave"
      className={cn(className)}
      onClick={onOpen}
    >
      <NavIcon name="calendar" className="size-4 text-muted-foreground" />
      <span className="flex-1">{t('label')}</span>
      {status && <span className="font-mono text-[11px] text-warning">{status}</span>}
    </button>
  );
}

/** The leave dialog for the signed-in member. Mount it outside the popover so closing the menu does not close the dialog. */
export function MyLeaveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('workspaces-teams-tenancy.myLeave');
  const { memberId } = useMyLeave();
  return (
    <MemberLeaveDialog
      memberId={memberId}
      memberName={t('title')}
      open={open && memberId !== null}
      onClose={onClose}
      self
    />
  );
}
