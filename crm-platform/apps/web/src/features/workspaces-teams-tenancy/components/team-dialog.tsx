'use client';

import { ConfirmDialog, Modal, useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WspTeam } from '@crm/contracts';
import { useRefreshWorkspace } from '../api/hooks';
import { wspApi } from '../api/service';
import { useErrorText } from './parts';
import { TeamUsageSummary } from './team-usage-summary';
import { TeamEditorForm, showsDevicePicker, type TeamDevice } from './team-editor-form';

export { showsDevicePicker, type TeamDevice };

/**
 * Create team / Edit team (TW-WSP-022, Teams v2): the form itself is `TeamEditorForm`; this wrapper owns the modal and, when
 * editing, Delete with its confirmation.
 */
export function TeamDialog({
  open,
  team,
  devices,
  canDelete,
  onClose,
}: {
  open: boolean;
  /** The team being edited; null creates one. */
  team: WspTeam | null;
  devices: readonly TeamDevice[];
  canDelete: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-teams-tenancy.teamDialog');
  const tt = useTranslations('workspaces-teams-tenancy.teams');
  const tc = useTranslations('workspaces-teams-tenancy.common');
  const { toast } = useToast();
  const errorText = useErrorText();
  const refresh = useRefreshWorkspace();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!team) return;
    setDeleting(true);
    try {
      await wspApi.deleteTeam(team.id);
      toast(tt('deleted'));
      setConfirmDelete(false);
      onClose();
      await refresh();
    } catch (err) {
      toast(tt('deleteFailed', { reason: errorText(err) }), 'danger');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        eyebrow={t('eyebrow')}
        title={t(team ? 'editTitle' : 'createTitle')}
        closeLabel={tc('close')}
      >
        {/* Mounted only while open, so every opening starts from the team (or a blank form). */}
        {open && (
          <TeamEditorForm
            team={team}
            devices={devices}
            onClose={onClose}
            onDelete={canDelete && team ? () => setConfirmDelete(true) : undefined}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={open && confirmDelete}
        title={tt('deleteTitle')}
        message={
          <>
            <p>{tt('deleteMessage', { name: team?.name ?? '' })}</p>
            {team && <TeamUsageSummary teamId={team.id} open={open && confirmDelete} />}
          </>
        }
        confirmLabel={tt('deleteConfirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
