'use client';

import { ConfirmDialog, Menu, MenuItem, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { WSP_INVITE_TTL_DAYS, type WspMember } from '@crm/contracts';
import { useAllMembers, useMembersSummary, useRefreshWorkspace } from '../api/hooks';
import { wspApi } from '../api/service';
import { canEditDetails, canRemove, canReset, canResend, seatsLine } from '../lib/roles';
import { DeactivateDialog } from './deactivate-dialog';
import { MemberDetailsDialog } from './member-details-dialog';
import { MemberLeaveDialog } from './member-leave-dialog';
import { LinkBanner, useErrorText } from './parts';

interface HandOver {
  key: string;
  title: string;
  body: string;
  link: string;
  email: string;
}

interface Options {
  /** `?member=<id>&reassign=1` of the "went on leave" notice: opens that person's leave dialog at the reassign part. */
  initialLeave?: { id: string; reassign: boolean } | null;
  /** Runs after something changed on the workspace members (a removal, a saved detail): the caller refreshes its own list. */
  onChanged?: () => void;
}

/**
 * Everything the old Team members screen (`/team-members`) did to ONE person besides changing roles and deactivating: change phone
 * and chat limit, leave and delegate (with the reassign of their work), resend an invite, reset a password, and remove from the
 * workspace. The screen was folded into Settings > Team members (Teams v2); this keeps every one of those actions reachable there as a
 * "More" menu, built from the same dialogs and calls. Removal asks what happens to the person's work first, like Deactivate.
 *
 * Returns the pieces the host screen places: `menu(id)` per row, `banners` above the table (a link to hand over when the e-mail could
 * not be sent), and `dialogs` once at the end.
 */
export function useMemberAccount({ initialLeave, onChanged }: Options = {}) {
  const t = useTranslations('workspaces-teams-tenancy.members');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const errorText = useErrorText();
  const refresh = useRefreshWorkspace();
  const summaryQ = useMembersSummary();
  const all = useAllMembers(true);

  const directory = useMemo(() => new Map(all.items.map((m) => [m.id, m])), [all.items]);
  const me = summaryQ.data?.me;

  const [editing, setEditing] = useState<WspMember | null>(null);
  const [leaveFor, setLeaveFor] = useState<{ id: string; name: string; reassign: boolean } | null>(
    initialLeave ? { id: initialLeave.id, name: '', reassign: initialLeave.reassign } : null,
  );
  const [confirmReset, setConfirmReset] = useState<WspMember | null>(null);
  const [removing, setRemoving] = useState<WspMember | null>(null);
  const [working, setWorking] = useState(false);
  const [handOvers, setHandOvers] = useState<HandOver[]>([]);

  const changed = async () => {
    await refresh();
    onChanged?.();
  };

  async function handOver(member: WspMember, kind: 'reset' | 'resend') {
    const call = kind === 'reset' ? wspApi.resetPassword : wspApi.resendInvite;
    setWorking(true);
    try {
      const res = await call(member.id);
      if (res.emailSent || !res.inviteLink) {
        toast(t(kind === 'reset' ? 'resetEmailed' : 'resendEmailed', { email: member.email }));
      } else {
        const h: HandOver = {
          key: `${kind}:${member.id}`,
          title: t('linkTitle', { name: member.fullName }),
          body: kind === 'reset' ? t('linkReset') : t('linkInvite', { days: WSP_INVITE_TTL_DAYS }),
          link: res.inviteLink,
          email: member.email,
        };
        setHandOvers((cur) => [h, ...cur.filter((x) => x.key !== h.key)]);
        toast(
          t(kind === 'reset' ? 'resetEmailed' : 'resendEmailed', { email: member.email }),
          'info',
        );
      }
      setConfirmReset(null);
      await changed();
    } catch (err) {
      toast(
        t(kind === 'reset' ? 'resetFailed' : 'resendFailed', { reason: errorText(err) }),
        'danger',
      );
      setConfirmReset(null);
    } finally {
      setWorking(false);
    }
  }

  async function remove(member: WspMember) {
    await wspApi.removeMember(member.id);
    toast(t('removed'));
    setRemoving(null);
    await changed();
  }

  function menu(userId: string): ReactNode {
    const member = directory.get(userId);
    if (!member || !me) return null;
    const active = member.status === 'active';
    const items: ReactNode[] = [];
    if (member.status !== 'inactive' && canEditDetails(member, me)) {
      items.push(
        <MenuItem key="edit" onSelect={() => setEditing(member)}>
          {t('editAction')}
        </MenuItem>,
      );
    }
    if (active) {
      items.push(
        <MenuItem
          key="leave"
          onSelect={() => setLeaveFor({ id: member.id, name: member.fullName, reassign: false })}
        >
          {t('leaveAction')}
        </MenuItem>,
      );
    }
    if (canResend(member, me)) {
      items.push(
        <MenuItem key="resend" onSelect={() => void handOver(member, 'resend')}>
          {t('resendAction')}
        </MenuItem>,
      );
    }
    if (canReset(member, me)) {
      items.push(
        <MenuItem key="reset" onSelect={() => setConfirmReset(member)}>
          {t('resetAction')}
        </MenuItem>,
      );
    }
    if (canRemove(member, me)) {
      items.push(
        <MenuItem key="remove" danger onSelect={() => setRemoving(member)}>
          {t('removeAction')}
        </MenuItem>,
      );
    }
    if (items.length === 0) return null;
    return (
      <Menu
        label={t('moreLabel', { name: member.fullName })}
        trigger={<span>{t('moreAction')}</span>}
        align="end"
        placement="fixed"
      >
        {items}
      </Menu>
    );
  }

  const banners = (
    <>
      {handOvers.map((h) => (
        <LinkBanner
          key={h.key}
          title={h.title}
          body={h.body}
          link={h.link}
          email={h.email}
          onDismiss={() => setHandOvers((cur) => cur.filter((x) => x.key !== h.key))}
        />
      ))}
    </>
  );

  const dialogs = (
    <>
      <MemberDetailsDialog
        member={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void changed()}
      />
      <MemberLeaveDialog
        memberId={leaveFor?.id ?? null}
        memberName={
          leaveFor ? leaveFor.name || (directory.get(leaveFor.id)?.fullName ?? '') : ''
        }
        open={leaveFor !== null}
        focusReassign={leaveFor?.reassign ?? false}
        onClose={() => setLeaveFor(null)}
      />
      <ConfirmDialog
        open={confirmReset !== null}
        title={t('resetTitle')}
        message={t('resetMessage', { name: confirmReset?.fullName ?? '' })}
        confirmLabel={t('resetConfirm')}
        cancelLabel={tc('cancel')}
        busy={working}
        onConfirm={() => confirmReset && void handOver(confirmReset, 'reset')}
        onClose={() => setConfirmReset(null)}
      />
      <DeactivateDialog
        member={removing ? { id: removing.id, fullName: removing.fullName } : null}
        onConfirm={() => (removing ? remove(removing) : undefined)}
        onClose={() => setRemoving(null)}
      />
    </>
  );

  return { menu, banners, dialogs, directory };
}

/** "3 of 10 seats used" under the Add member button (the seat line the old Team members screen showed). Nothing while loading. */
export function SeatsNote() {
  const t = useTranslations('workspaces-teams-tenancy.members');
  const summary = useMembersSummary().data;
  const seats = seatsLine(summary?.seats);
  if (!seats) return null;
  return (
    <span
      data-testid="seats"
      className={seats.full ? 'text-xs font-medium text-warning' : 'text-xs text-muted-foreground'}
    >
      {t(seats.full ? 'seatsFull' : 'seats', { used: seats.used, limit: seats.limit })}
    </span>
  );
}
