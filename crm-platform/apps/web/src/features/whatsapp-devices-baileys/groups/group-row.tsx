'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WaDeviceGroup } from '@crm/contracts';
import { Badge, Button, ConfirmDialog } from '@crm/ui';
import { useLeaveWaGroup } from '../api/groups-hooks';
import { formatWhen } from '../lib/format';
import { EditGroupModal } from './edit-group-modal';
import { GroupPicture } from './group-picture';
import { useGroupsCtx } from './groups-context';
import { rowAccess, rowBadges } from './groups-model';
import { InviteLinkPanel } from './invite-link-panel';
import { JoinRequests } from './join-requests';
import { MembersModal } from './members-modal';

const TONE = {
  admin: 'success',
  notAdmin: 'neutral',
  left: 'danger',
  announce: 'warning',
  restrict: 'warning',
  approval: 'neutral',
} as const;

/**
 * One group: picture, subject, description, the badges (admin or not, left, admins-only send, admins-only edit, approval), the member
 * count and who is in, then Edit, Members, Leave and the invite link and join queue. Everything shown is plain text: a subject or a
 * member name that looks like markup is drawn as text, never as markup.
 */
export function GroupRow({ group }: { group: WaDeviceGroup }) {
  const t = useTranslations('whatsapp-devices-baileys.groups');
  const locale = useLocale();
  const { device, online, perms, waitSeconds, notify, fail } = useGroupsCtx();
  const access = rowAccess(group, perms, online);
  const leave = useLeaveWaGroup(device.id);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const names = group.participantsPreview
    .map((p) => p.name?.trim())
    .filter((n): n is string => Boolean(n));
  const leftAt = formatWhen(group.leftAt, locale);

  return (
    <div className="border-b border-border px-5 py-4 last:border-0" data-group-row={group.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <GroupPicture url={group.pictureUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" dir="auto" data-testid="groups-subject">
              {group.subject || t('untitled')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="groups-badges">
              {rowBadges(group).map((b) => (
                <Badge key={b} tone={TONE[b]} data-badge={b}>
                  {t(`badge.${b}`)}
                </Badge>
              ))}
              {group.pendingRequestCount > 0 && !group.left && (
                <Badge tone="warning" data-badge="requests">
                  {t('badge.requests', { count: group.pendingRequestCount })}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('memberCount', { count: group.size })}
              {names.length > 0 && (
                <>
                  <span className="mx-1">·</span>
                  <span dir="auto">
                    {names.join(', ')}
                    {group.participantsCount > names.length ? '…' : ''}
                  </span>
                </>
              )}
            </p>
            {group.description && (
              <p
                dir="auto"
                className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground"
                data-testid="groups-description"
              >
                {group.description}
              </p>
            )}
            {group.left && (
              <p className="mt-1 text-xs text-danger" data-testid="groups-left-note">
                {leftAt ? t('leftOn', { date: leftAt }) : t('leftNote')}
              </p>
            )}
            {perms.manage && access.blockedBy && !group.left && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="groups-blocked-note">
                {t(`blocked.${access.blockedBy}`)}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {group.conversationId && (
            <Link
              href={`/inbox?c=${group.conversationId}`}
              className="text-sm underline"
              data-testid="groups-open-chat"
            >
              {t('openChat')}
            </Link>
          )}
          {perms.manage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!access.canAdminister}
              onClick={() => setEditing(true)}
            >
              {t('editButton')}
            </Button>
          )}
          {access.canSeeMembers && (
            <Button variant="secondary" size="sm" onClick={() => setViewing(true)}>
              {t('membersButton')}
            </Button>
          )}
          {perms.leave && !group.left && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!access.canLeave || waitSeconds > 0}
              onClick={() => setConfirmLeave(true)}
            >
              <span className="text-danger">{t('leave')}</span>
            </Button>
          )}
        </div>
      </div>

      <InviteLinkPanel group={group} />
      <JoinRequests group={group} />

      <ConfirmDialog
        open={confirmLeave}
        title={t('confirm.leaveTitle')}
        message={t('confirm.leaveMessage', { name: group.subject ?? t('untitled') })}
        confirmLabel={t('confirm.leaveConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={leave.isPending}
        onConfirm={() =>
          leave.mutate(group.id, {
            onSuccess: () => {
              setConfirmLeave(false);
              notify({ tone: 'success', text: t('notice.left') });
            },
            onError: (err) => {
              setConfirmLeave(false);
              fail(err);
            },
          })
        }
        onClose={() => setConfirmLeave(false)}
      />
      {perms.manage && editing && (
        <EditGroupModal group={group} open onClose={() => setEditing(false)} />
      )}
      {access.canSeeMembers && viewing && (
        <MembersModal group={group} open onClose={() => setViewing(false)} />
      )}
    </div>
  );
}
