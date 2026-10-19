import type { ConversationStatus } from '@crm/contracts';
import type { BadgeTone } from '@/components/ui/badge';

/** The colour family of a conversation status; the word always goes with it. */
export const STATUS_TONE: Record<ConversationStatus, BadgeTone> = {
  open: 'success',
  snoozed: 'info',
  resolved: 'neutral',
  closed: 'neutral',
  spam: 'danger',
};
