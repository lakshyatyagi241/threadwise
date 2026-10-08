'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WabaGroup } from '@crm/contracts';
import { Button, ConfirmDialog } from '@crm/ui';
import { useDeleteGroup, useRefreshGroup } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';
import { EditGroupModal } from './edit-group-modal';
import type { GroupNotice } from './groups-model';
import { InviteLinkPanel } from './invite-link-panel';
import { JoinRequests } from './join-requests';
import { MembersModal } from './members-modal';

/** One group: subject, member count, approval tag, the suspended line, Refresh and Delete, then its invite link and its join queue. */
export function GroupRow({
  number,
  group,
  canManage,
  canDelete,
  onNotice,
}: {
  number: string;
  group: WabaGroup;
  canManage: boolean;
  canDelete: boolean;
  onNotice: (n: GroupNotice) => void;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups');
  const errorText = useErrorText();
  const refresh = useRefreshGroup(number);
  const remove = useDeleteGroup(number);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);

  const fail = (err: unknown) => {
    const et = errorText(err);
    onNotice({ tone: 'danger', text: et.text, requestId: et.requestId });
  };

  return (
    <div className="border-b border-border px-5 py-4 last:border-0" data-group-row={group.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.subject || t('list.untitled')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('list.members', { count: group.participantCount })}
            {group.joinApprovalMode === 'approval_required' && (
              <>
                <span className="mx-1">·</span>
                {t('list.approvalRequired')}
              </>
            )}
          </p>
          {group.suspended && <p className="mt-1 text-xs text-danger">{t('list.suspended')}</p>}
          {group.lastError?.message && (
            <p className="mt-1 text-xs text-danger">
              {t('list.creationFailed', { message: group.lastError.message })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canManage && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t('list.edit')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setViewing(true)}>
                {t('list.membersButton')}
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(group.id, {
                onSuccess: () => onNotice({ tone: 'success', text: t('notice.refreshed') }),
                onError: fail,
              })
            }
          >
            {refresh.isPending ? t('list.refreshing') : t('list.refresh')}
          </Button>
          {canDelete && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(true)}>
              <span className="text-danger">{t('list.delete')}</span>
            </Button>
          )}
        </div>
      </div>

      <InviteLinkPanel number={number} group={group} canManage={canManage} onNotice={onNotice} />
      <JoinRequests number={number} group={group} canManage={canManage} onNotice={onNotice} />

      <ConfirmDialog
        open={confirmDelete}
        title={t('confirm.deleteTitle')}
        message={t('confirm.deleteMessage')}
        confirmLabel={t('confirm.deleteConfirm')}
        cancelLabel={t('confirm.cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(group.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              onNotice({ tone: 'success', text: t('notice.deleted') });
            },
            onError: (err) => {
              setConfirmDelete(false);
              fail(err);
            },
          })
        }
        onClose={() => setConfirmDelete(false)}
      />
      {canManage && editing && (
        <EditGroupModal
          number={number}
          group={group}
          open
          onClose={() => setEditing(false)}
          onNotice={onNotice}
        />
      )}
      {canManage && viewing && (
        <MembersModal
          number={number}
          group={group}
          open
          onClose={() => setViewing(false)}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}
