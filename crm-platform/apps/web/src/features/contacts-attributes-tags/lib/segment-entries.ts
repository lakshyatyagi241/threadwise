/**
 * The rows of the Contact Hub's "Select Segment" dropdown, and how its search narrows them. Pure: the component only
 * draws what this returns and keeps the active row.
 */

export const SEGMENT_PREFIX = 'segment:';

export type EntrySection = 'contacts' | 'groups' | 'segments';

export interface Entry {
  /** '' = everyone, 'imported', 'no_group', a group id, or `segment:<id>`. */
  value: string;
  label: string;
  /** The live count at the end of the row. */
  hint?: string;
  /** Colour dot; `undefined` = no dot (the quick lists), `null` = the default colour. */
  color?: string | null;
  section: EntrySection;
}

export interface EntryInput {
  q: string;
  counts: { total?: number; imported?: number; noGroup?: number };
  groups: ReadonlyArray<{ id: string; name: string; color: string | null; memberCount: number }>;
  segments: ReadonlyArray<{
    id: string;
    name: string;
    color: string | null;
    memberCount: number | null;
    countApproximate: boolean;
  }>;
  labels: { all: string; imported: string; noGroup: string; approx: (count: number) => string };
}

const num = (n: number | undefined) => (n === undefined ? undefined : n.toLocaleString());

export function pickerEntries({ q, counts, groups, segments, labels }: EntryInput): Entry[] {
  const all: Entry[] = [
    { value: '', label: labels.all, hint: num(counts.total), section: 'contacts' },
    { value: 'imported', label: labels.imported, hint: num(counts.imported), section: 'contacts' },
    { value: 'no_group', label: labels.noGroup, hint: num(counts.noGroup), section: 'contacts' },
    ...groups.map((g): Entry => ({
      value: g.id,
      label: g.name,
      hint: g.memberCount.toLocaleString(),
      color: g.color,
      section: 'groups',
    })),
    ...segments.map((s): Entry => ({
      value: `${SEGMENT_PREFIX}${s.id}`,
      label: s.name,
      hint:
        s.memberCount === null
          ? undefined
          : s.countApproximate
            ? labels.approx(s.memberCount)
            : s.memberCount.toLocaleString(),
      color: s.color,
      section: 'segments',
    })),
  ];
  const needle = q.trim().toLocaleLowerCase();
  return needle ? all.filter((e) => e.label.toLocaleLowerCase().includes(needle)) : all;
}

/** The dropdown's value for the active filters: a segment wins over a group, a group over the quick lists. */
export function pickerValue(f: { group: string; imported: boolean; segment: string }): string {
  return f.segment ? `${SEGMENT_PREFIX}${f.segment}` : f.imported ? 'imported' : f.group;
}

/** The filters a dropdown value stands for: picking a group, a segment or a quick list replaces the previous pick. */
export function filtersOfPicker(value: string): {
  group: string;
  imported: boolean;
  segment: string;
} {
  if (value.startsWith(SEGMENT_PREFIX)) {
    return { segment: value.slice(SEGMENT_PREFIX.length), group: '', imported: false };
  }
  return { segment: '', imported: value === 'imported', group: value === 'imported' ? '' : value };
}

/** The next active row after an arrow key, clamped to the list. */
export function moveActive(active: number, key: 'ArrowDown' | 'ArrowUp', length: number): number {
  if (length === 0) return 0;
  return key === 'ArrowDown' ? Math.min(active + 1, length - 1) : Math.max(active - 1, 0);
}
