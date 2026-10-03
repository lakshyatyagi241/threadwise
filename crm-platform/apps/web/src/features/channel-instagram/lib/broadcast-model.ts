import { IG_SEND_MAX, type IgCompose, type IgSendResult } from '@crm/contracts';

/** Pure rules of the reply-only compose screen (TW-IG-013, 014): which threads show, how many can be picked, what a result says. */

export type Thread = IgCompose['threads'][string][number];

export const MESSAGE_MAX = 1000;
export const NAME_MAX = 255;

/** Threads whose title contains the search (case-insensitive); an empty search keeps them all. */
export function filterThreads(threads: readonly Thread[], query: string): Thread[] {
  const q = query.trim().toLowerCase();
  return q === '' ? [...threads] : threads.filter((t) => t.title.toLowerCase().includes(q));
}

/** Ticks or unticks one thread; a thread past the cap is not added. */
export function toggle(picked: ReadonlySet<string>, id: string, max = IG_SEND_MAX): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else if (next.size < max) next.add(id);
  return next;
}

/** Picks the first `max` of the shown threads, replacing whatever was picked. */
export function selectAll(shown: readonly Thread[], max = IG_SEND_MAX): Set<string> {
  return new Set(shown.slice(0, max).map((t) => t.id));
}

/** Are there more shown threads than one send can reach? */
export const exceedsCap = (shown: readonly Thread[], max = IG_SEND_MAX): boolean =>
  shown.length > max;

/** A template fills the message only while the message is empty, so it never overwrites what was typed. */
export const prefill = (current: string, templateBody: string): string =>
  current.trim() === '' ? templateBody : current;

export function canSend(s: {
  name: string;
  message: string;
  picked: number;
  busy: boolean;
}): boolean {
  return (
    !s.busy &&
    s.name.trim() !== '' &&
    s.message.trim() !== '' &&
    s.message.trim().length <= MESSAGE_MAX &&
    s.picked > 0
  );
}

/** What a send came to: nothing went, some went with some failing, or all went. */
export function outcomeOf(r: IgSendResult): 'none' | 'partial' | 'all' {
  if (r.sent === 0) return 'none';
  return r.failed > 0 ? 'partial' : 'all';
}

/** How many of the threads can be reached right now (their 24 hour window is open). */
export const openCount = (threads: readonly Thread[]): number =>
  threads.filter((t) => t.windowOpen).length;
