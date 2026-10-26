import type { CallerEntry } from '@/lib/device/caller-id';
import { listContacts } from './api';

const PAGE = 200;

/**
 * The most contacts the phone is given. The list is read from the server page by page and kept on the phone, so a workspace with
 * more contacts than this names the newest ones; the screen says how many the phone has.
 */
export const CALLER_MAX_CONTACTS = 5000;

/**
 * Every contact that has a number, newest first, as the phone needs them to name a caller: an id (to open the contact), a name (the
 * number when the contact has none) and the number. Reads at most {@link CALLER_MAX_CONTACTS}.
 */
export async function loadCallerEntries(signal?: AbortSignal): Promise<CallerEntry[]> {
  const entries: CallerEntry[] = [];
  let cursor: string | undefined;
  while (entries.length < CALLER_MAX_CONTACTS) {
    const answer = await listContacts({ limit: PAGE, cursor }, signal);
    for (const contact of answer.data) {
      const phone = contact.phone?.trim();
      if (!phone) continue;
      entries.push({ id: contact.id, name: contact.name?.trim() || phone, phone });
    }
    if (!answer.page.hasMore || !answer.page.nextCursor) break;
    cursor = answer.page.nextCursor;
  }
  return entries.slice(0, CALLER_MAX_CONTACTS);
}
