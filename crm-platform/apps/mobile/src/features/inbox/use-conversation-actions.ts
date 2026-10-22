import {
  ERROR_CODES,
  type ConversationPriority,
  type InboxConversationDetail,
  type SetConversationStatusInput,
} from '@crm/contracts';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import type { AssignmentChange } from './assign-sheet';
import { snoozeUntil, type SnoozeChoice } from './thread-actions';
import { sendErrorMessage } from './thread-errors';
import {
  useAssign,
  useMarkSpam,
  useReturnToBot,
  useSetPriority,
  useSetStatus,
  useSnooze,
} from './use-inbox';

/**
 * The changes a person makes to a conversation, shared by the thread and its details screen: each takes the row version the screen
 * last read, and answers with the sentence to show when it failed (a stale version is the "someone else changed it" one) or `null`
 * when it worked. The lists and the thread read again either way, so the next press carries the current version.
 */
export function useConversationActions(
  id: string,
  conversation: InboxConversationDetail | undefined,
) {
  const { t } = useTranslation();
  const setStatus = useSetStatus(id);
  const assign = useAssign(id);
  const setPriority = useSetPriority(id);
  const snooze = useSnooze(id);
  const spam = useMarkSpam(id);
  const toBot = useReturnToBot(id);

  const run = async (action: () => Promise<unknown>): Promise<string | null> => {
    try {
      await action();
      return null;
    } catch (error) {
      return isApiError(error) && error.code === ERROR_CODES.ROW_VERSION_CONFLICT
        ? t('inbox.thread.conflict')
        : sendErrorMessage(error, t);
    }
  };

  return {
    /** True while any of the changes is on its way. */
    busy:
      setStatus.isPending ||
      assign.isPending ||
      setPriority.isPending ||
      snooze.isPending ||
      spam.isPending ||
      toBot.isPending,
    assigning: assign.isPending,
    givingToBot: toBot.isPending,
    /** Hands the conversation back to the bot; it needs no row version. */
    giveToBot: async () => run(() => toBot.mutateAsync()),
    moveTo: async (status: SetConversationStatusInput['status']) =>
      conversation
        ? run(() => setStatus.mutateAsync({ rowVersion: conversation.rowVersion, status }))
        : null,
    markSpam: async () =>
      conversation ? run(() => spam.mutateAsync({ rowVersion: conversation.rowVersion })) : null,
    assignTo: async (change: AssignmentChange) =>
      conversation
        ? run(() => assign.mutateAsync({ rowVersion: conversation.rowVersion, ...change }))
        : null,
    prioritise: async (priority: ConversationPriority) =>
      conversation
        ? run(() => setPriority.mutateAsync({ rowVersion: conversation.rowVersion, priority }))
        : null,
    /** The time is worked out when the person presses, from the clock then. */
    snoozeFor: async (choice: SnoozeChoice) =>
      conversation
        ? run(() =>
            snooze.mutateAsync({
              rowVersion: conversation.rowVersion,
              until: snoozeUntil(choice, new Date()),
            }),
          )
        : null,
  };
}
