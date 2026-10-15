import type { QueryClient } from '@tanstack/react-query';

/**
 * The cached sender lists of the campaign screens (the guided flow's `GET /broadcast-wizard/senders` and the builder's
 * `GET /campaigns/builder`). A screen that connects, finishes or removes a WhatsApp number calls `invalidateSenderLists` so the
 * "Send from" list shows the change at once instead of after its cache expires.
 */
export const SENDER_LIST_KEYS = [
  ['camp', 'wizard', 'senders'],
  ['camp', 'builder'],
] as const;

export function invalidateSenderLists(qc: QueryClient): Promise<unknown> {
  return Promise.all(SENDER_LIST_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}
