import { z } from 'zod';

/**
 * The WhatsApp summary on a contact's Stats tab: how many messages went to and came from the contact on WhatsApp channels.
 * Counted from the contact's conversations (system notices left out):
 *
 *   - sent:      messages sent to the contact (a failed one counts, the way the Reference counted it);
 *   - delivered: of those, reached the phone (delivered or read);
 *   - seen:      of those, read;
 *   - received:  messages the contact sent;
 *   - failed:    of the sent ones, never left;
 *   - replied:   sent messages (not failed) that the contact answered, i.e. the next message in the thread is theirs.
 */
export const contactMessageStatsSchema = z.object({
  sent: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  seen: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
});
export type ContactMessageStats = z.infer<typeof contactMessageStatsSchema>;
