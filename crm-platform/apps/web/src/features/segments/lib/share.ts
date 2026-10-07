import { SEGMENT_SHARE_MAX, type Person, type Segment, type TeamOption } from '../api/schemas';

/** "Specific people": who a segment is shared with, as the form edits it and as a badge reads it. All pure. */

export { SEGMENT_SHARE_MAX };

/** One row of the picker: a person or a team the segment can be shared with. */
export interface ShareOption {
  kind: 'user' | 'team';
  id: string;
  name: string;
  /** A person's email, or null (a team, or a person whose email the caller may not read). */
  email: string | null;
  /** A team's size. */
  memberCount?: number;
}

export interface ShareSelection {
  userIds: string[];
  teamIds: string[];
}

export const selectionSize = (s: ShareSelection): number => s.userIds.length + s.teamIds.length;

export const emptySelection = (): ShareSelection => ({ userIds: [], teamIds: [] });

/** Add or remove one id; a selection never holds the same id twice and never passes the contract's cap. */
export function toggleShare(
  s: ShareSelection,
  kind: ShareOption['kind'],
  id: string,
  on: boolean,
): ShareSelection {
  const key = kind === 'user' ? 'userIds' : 'teamIds';
  const has = s[key].includes(id);
  if (on === has) return s;
  if (on && selectionSize(s) >= SEGMENT_SHARE_MAX) return s;
  return { ...s, [key]: on ? [...s[key], id] : s[key].filter((x) => x !== id) };
}

/** People (active ones, by name) then teams (by name) as picker rows. */
export function buildShareOptions(
  people: readonly Person[] | undefined,
  teams: readonly TeamOption[] | undefined,
): ShareOption[] {
  const byName = (a: ShareOption, b: ShareOption) => a.name.localeCompare(b.name);
  const users: ShareOption[] = (people ?? [])
    .filter((p) => p.status !== 'inactive')
    .map((p) => ({ kind: 'user', id: p.id, name: p.fullName, email: p.email ?? null }));
  const groups: ShareOption[] = (teams ?? []).map((t) => ({
    kind: 'team',
    id: t.id,
    name: t.name,
    email: null,
    memberCount: t.members?.length ?? 0,
  }));
  return [...users.sort(byName), ...groups.sort(byName)];
}

/** The picker's rows that match a typed search (name or email, any case); everything for a blank search. */
export function filterShareOptions(options: readonly ShareOption[], query: string): ShareOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...options];
  return options.filter((o) => `${o.name} ${o.email ?? ''}`.toLocaleLowerCase().includes(needle));
}

/**
 * The chips of the current selection, in the order picked. A pick that is not among the options (a person who left, a
 * lookup that has not loaded) still shows, by the name the server last sent, so it can be removed.
 */
export function selectedChips(
  selection: ShareSelection,
  options: readonly ShareOption[],
  known: Pick<Segment, 'sharedWith'>['sharedWith'] | undefined,
): ShareOption[] {
  const byKey = new Map(options.map((o) => [`${o.kind}:${o.id}`, o]));
  const knownKey = new Map<string, ShareOption>();
  for (const u of known?.users ?? [])
    knownKey.set(`user:${u.id}`, { kind: 'user', id: u.id, name: u.name, email: u.email });
  for (const t of known?.teams ?? [])
    knownKey.set(`team:${t.id}`, {
      kind: 'team',
      id: t.id,
      name: t.name,
      email: null,
      memberCount: t.memberCount,
    });
  const chip = (kind: 'user' | 'team', id: string): ShareOption =>
    byKey.get(`${kind}:${id}`) ??
    knownKey.get(`${kind}:${id}`) ?? { kind, id, name: id, email: null };
  return [
    ...selection.userIds.map((id) => chip('user', id)),
    ...selection.teamIds.map((id) => chip('team', id)),
  ];
}

/** What the visibility badge says about a `specific` segment: how many, and the first names for the tooltip. */
export function shareSummary(
  sharedWith: Pick<Segment, 'sharedWith'>['sharedWith'],
  maxNames = 8,
): { count: number; names: string[]; more: number } {
  const all = [...sharedWith.users.map((u) => u.name), ...sharedWith.teams.map((t) => t.name)];
  return {
    count: all.length,
    names: all.slice(0, maxNames),
    more: Math.max(0, all.length - maxNames),
  };
}

/** The same people and teams, whatever the order they were picked in (the unsaved-changes guard compares with this). */
export const selectionSignature = (s: ShareSelection): string =>
  JSON.stringify([[...s.userIds].sort(), [...s.teamIds].sort()]);
