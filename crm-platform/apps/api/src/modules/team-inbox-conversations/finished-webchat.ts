import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, isFinishedWebchat, type ConversationStatus } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * Refuses an agent's move that would bring a finished web chat back to life: a reopen, a snooze (it wakes as open) or a spam mark. The
 * rule is `isFinishedWebchat` in @crm/contracts, shared with the inbox, which offers none of these for such a chat. The answer is the
 * state machine's own code (`CONVERSATION_STATUS_INVALID`, 422), so the web shows the same message for every route.
 */
export function assertNotFinishedWebchat(
  channelKind: string,
  status: string,
  action: 'reopened' | 'snoozed' | 'marked as spam',
): void {
  if (!isFinishedWebchat(channelKind, status as ConversationStatus)) return;
  throw new AppError(
    ERROR_CODES.CONVERSATION_STATUS_INVALID,
    `A ${status} web chat cannot be ${action}`,
    HttpStatus.UNPROCESSABLE_ENTITY,
    [{ path: 'status', message: `a ${status} web chat cannot be ${action}` }],
  );
}
