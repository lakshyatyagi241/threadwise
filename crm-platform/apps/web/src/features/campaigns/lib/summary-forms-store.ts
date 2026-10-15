import { cleanFormIds } from './summary-model';

/**
 * "Which forms count as an application?" is remembered per person in this browser. Storage can be missing or throw (a private window,
 * blocked site data), so every read and write is wrapped and the screen works the same without it.
 */
const key = (userId: string) => `campaigns.summary.forms.${userId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** What is stored for this person, as text ('' when nothing or when storage cannot be read). */
export function rawFormIds(userId: string, from: Store | null = store()): string {
  try {
    return from?.getItem(key(userId)) ?? '';
  } catch {
    return '';
  }
}

/** The picked forms from stored text; damaged or foreign text is an empty choice. */
export function parseFormIds(raw: string): string[] {
  try {
    return raw ? cleanFormIds(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function readFormIds(userId: string, from: Store | null = store()): string[] {
  return parseFormIds(rawFormIds(userId, from));
}

export function writeFormIds(userId: string, ids: readonly string[], to: Store | null = store()) {
  try {
    if (ids.length === 0) to?.removeItem(key(userId));
    else to?.setItem(key(userId), JSON.stringify(cleanFormIds([...ids])));
  } catch {
    /* not remembered; the choice still applies on this screen */
  }
}
