import type { ConversationAssignment } from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { messageForError } from '@/lib/api/error-message';
import { ChoiceSheet, type ChoiceGroup } from './choice-sheet';
import { useAssignees } from './use-inbox';

/** What the sheet hands back: only the parts that changed (an omitted one leaves that part of the assignment alone). */
export interface AssignmentChange {
  userId?: string | null;
  teamId?: string | null;
}

interface Props {
  visible: boolean;
  /** Who has the conversation now. */
  /** Who has the conversation now; ignored in bulk mode. */
  assignment: ConversationAssignment;
  /** Several conversations at once: nothing is chosen to begin with, and "Unassigned" / "No team" are real choices. */
  bulk?: boolean;
  saving: boolean;
  error: string | null;
  onSave: (change: AssignmentChange) => void;
  onClose: () => void;
}

/**
 * "Change agent": every active member who may open the inbox (with whether they are online and how many open conversations they
 * have right now) and, when the workspace has teams, the teams. One choice in each, "Unassigned" and "No team" included, then Save.
 * Only for a person who may hand a conversation to anyone (`inbox.conversation.assign`).
 */
export function AssignSheet({ visible, assignment, bulk, saving, error, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const assignees = useAssignees(visible);
  const users = assignees.data?.users ?? [];
  const teams = assignees.data?.teams ?? [];

  const groups: ChoiceGroup[] = [
    {
      key: 'user',
      title: t('inbox.assign.agents'),
      options: [
        { value: '', label: t('inbox.assign.unassigned') },
        ...[...users]
          .sort((a, b) => Number(b.isMe) - Number(a.isMe))
          .map((u) => {
            const name = u.name ?? u.email;
            return {
              value: u.id,
              label: u.isMe ? t('inbox.assign.you', { name }) : name,
              hint: `${t(`inbox.assign.availability.${u.availability}`)} · ${t('inbox.assign.open', { count: u.openConversations })}`,
            };
          }),
      ],
    },
    ...(teams.length > 0
      ? [
          {
            key: 'team',
            title: t('inbox.assign.teams'),
            options: [
              { value: '', label: t('inbox.assign.noTeam') },
              ...teams.map((team) => ({
                value: team.id,
                label: team.name,
                hint: t('inbox.assign.members', { count: team.memberCount }),
              })),
            ],
          },
        ]
      : []),
  ];
  // In bulk mode "nothing chosen" is a value no option has, so even "Unassigned" counts as a change.
  const NOTHING = '\u0000';
  const initial = bulk
    ? { user: NOTHING, team: NOTHING }
    : { user: assignment.user?.id ?? '', team: assignment.team?.id ?? '' };

  return (
    <ChoiceSheet
      visible={visible}
      title={t('inbox.assign.title')}
      groups={groups}
      initial={initial}
      searchLabel={t('inbox.assign.search')}
      loading={assignees.isPending}
      loadError={assignees.error ? messageForError(assignees.error, t) : null}
      onRetry={() => void assignees.refetch()}
      saving={saving}
      error={error}
      onSave={(picked) => {
        const change: AssignmentChange = {};
        if ((picked.user ?? '') !== initial.user) change.userId = picked.user || null;
        if ((picked.team ?? '') !== initial.team) change.teamId = picked.team || null;
        onSave(change);
      }}
      onClose={onClose}
    />
  );
}
