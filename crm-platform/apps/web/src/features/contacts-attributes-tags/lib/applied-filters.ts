import { ownerTokens, UNASSIGNED_OWNER, type ContactFilters } from '../api/contacts';
import { SEGMENT_PREFIX } from './segment-entries';

/**
 * The chips under the Contact Hub's toolbar: one per active filter, each with the change that removes it. Pure; the screen passes
 * in how to name a group, a segment, a tag, a person, a stage and a status, and the words.
 */

export type FilterChipKind =
  'segment' | 'tag' | 'owner' | 'stage' | 'status' | 'consent' | 'source' | 'rules';

export interface FilterChip {
  /** Stable key for React and for tests. */
  id: string;
  kind: FilterChipKind;
  /** "Tag: VIP" as one text; `label` is the kind's name and `value` what was chosen. */
  label: string;
  value: string;
  /** Applying this patch to the filters removes the chip. */
  clear: Partial<ContactFilters>;
}

export interface ChipNames {
  words: {
    segment: string;
    group: string;
    tag: string;
    owner: string;
    stage: string;
    status: string;
    consent: string;
    source: string;
    conditions: string;
    imported: string;
    noGroup: string;
    unassigned: string;
    myContacts: string;
    formerMember: string;
    subscribed: string;
    unsubscribed: string;
    /** "Conditions: {count}" */
    conditionsValue: (count: number) => string;
  };
  group: (id: string) => string | undefined;
  segment: (id: string) => string | undefined;
  tag: (id: string) => string | undefined;
  owner: (id: string) => string | undefined;
  stage: (value: string) => string | undefined;
  status: (value: string) => string | undefined;
  /** How many conditions the rules hold. */
  conditionCount: (rules: string) => number;
  /** What the AI understood, when the applied rules are the ones it produced. */
  aiSummary: string | null;
  meId: string;
}

const text = (label: string, value: string) => `${label}: ${value}`;

export function appliedFilterChips(f: ContactFilters, n: ChipNames): FilterChip[] {
  const w = n.words;
  const out: FilterChip[] = [];
  const clearPicker = { group: '', imported: false, segment: '' } as const;

  if (f.segment) {
    const name = n.segment(f.segment) ?? f.segment.slice(0, 8);
    out.push({
      id: `${SEGMENT_PREFIX}${f.segment}`,
      kind: 'segment',
      label: text(w.segment, name),
      value: name,
      clear: clearPicker,
    });
  } else if (f.imported) {
    out.push({
      id: 'imported',
      kind: 'segment',
      label: w.imported,
      value: w.imported,
      clear: clearPicker,
    });
  } else if (f.group === 'no_group') {
    out.push({
      id: 'no_group',
      kind: 'segment',
      label: w.noGroup,
      value: w.noGroup,
      clear: clearPicker,
    });
  } else if (f.group) {
    const name = n.group(f.group) ?? f.group.slice(0, 8);
    out.push({
      id: `group:${f.group}`,
      kind: 'segment',
      label: text(w.group, name),
      value: name,
      clear: clearPicker,
    });
  }

  if (f.tag) {
    const name = n.tag(f.tag) ?? f.tag.slice(0, 8);
    out.push({
      id: `tag:${f.tag}`,
      kind: 'tag',
      label: text(w.tag, name),
      value: name,
      clear: { tag: '' },
    });
  }

  const owners = ownerTokens(f.owner);
  if (owners.length > 0) {
    const names = owners.map((o) =>
      o === UNASSIGNED_OWNER
        ? w.unassigned
        : o === n.meId
          ? w.myContacts
          : (n.owner(o) ?? w.formerMember),
    );
    const value = names.join(', ');
    out.push({
      id: `owner:${owners.join(',')}`,
      kind: 'owner',
      label: text(w.owner, value),
      value,
      clear: { owner: '' },
    });
  }

  if (f.lifecycleStage) {
    const name = n.stage(f.lifecycleStage) ?? f.lifecycleStage;
    out.push({
      id: `stage:${f.lifecycleStage}`,
      kind: 'stage',
      label: text(w.stage, name),
      value: name,
      clear: { lifecycleStage: '' },
    });
  }

  if (f.status) {
    const name = n.status(f.status) ?? f.status;
    out.push({
      id: `status:${f.status}`,
      kind: 'status',
      label: text(w.status, name),
      value: name,
      clear: { status: '' },
    });
  }

  if (f.consent) {
    const name = f.consent === 'subscribed' ? w.subscribed : w.unsubscribed;
    out.push({
      id: `consent:${f.consent}`,
      kind: 'consent',
      label: text(w.consent, name),
      value: name,
      clear: { consent: '' },
    });
  }

  if (f.source.trim()) {
    const name = f.source.trim();
    out.push({
      id: `source:${name}`,
      kind: 'source',
      label: text(w.source, name),
      value: name,
      clear: { source: '' },
    });
  }

  if (f.rules) {
    const value = n.aiSummary ?? w.conditionsValue(n.conditionCount(f.rules));
    out.push({ id: 'rules', kind: 'rules', label: value, value, clear: { rules: '' } });
  }

  return out;
}

/** The patch that removes every chip at once (the search text is not a chip and stays). */
export function clearAllPatch(): Partial<ContactFilters> {
  return {
    group: '',
    imported: false,
    segment: '',
    tag: '',
    owner: '',
    lifecycleStage: '',
    status: '',
    consent: '',
    source: '',
    rules: '',
  };
}
