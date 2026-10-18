import { HOT_FROM } from '@/features/lead-scoring';
import { DEFAULT_FILTERS, UNASSIGNED_OWNER, type ContactFilters } from '../api/contacts';
import { sameFilters } from './views';

/**
 * The built-in views of the Contacts list ("Default filters" in the view picker). They are not stored: each one is a set of filters
 * (the same conditions the "Add condition" builder writes), so choosing one is the same as filtering by hand, and the picker marks
 * the one whose conditions are on screen.
 */
export const PRESET_VIEWS = [
  'myContacts',
  'unassigned',
  'uncontacted',
  'hotLeads',
  'newThisWeek',
  'newLastWeek',
  'recentlyCreated',
  'recentlyModified',
  'recentlyImported',
  'neverContacted',
  'needsFollowUp',
  'active',
  'inactive',
  'unsubscribed',
  'minors',
] as const;
export type PresetView = (typeof PRESET_VIEWS)[number];

/** The built-in views drawn as quick chips beside the view picker: what a small business reaches for first. */
export const QUICK_PRESETS = [
  'myContacts',
  'unassigned',
  'uncontacted',
  'newThisWeek',
  'needsFollowUp',
  'hotLeads',
] as const satisfies readonly PresetView[];

/** The built-in views that filter by the lead score: they are offered only while lead scoring is on for the workspace. */
const SCORE_PRESETS: readonly PresetView[] = ['hotLeads'];

/**
 * `presets` without the ones that do not apply: "Hot leads" needs lead scoring (off: it filters by a score nobody sees), and
 * "Uncontacted" is offered only once some contact carries the marker (BL-290), so a workspace that never uses the feature sees no new
 * chip. `uncontacted` defaults to true for callers that do not know.
 */
export function availablePresets<T extends PresetView>(
  presets: readonly T[],
  scoringOn: boolean,
  uncontacted = true,
): T[] {
  return presets.filter(
    (p) => (scoringOn || !SCORE_PRESETS.includes(p)) && (uncontacted || p !== 'uncontacted'),
  );
}

type Cond = { field: string; operator: string; value?: number | string };

type Node = Cond | { any: Cond[] };

const node = (n: Node) =>
  'any' in n
    ? {
        type: 'group',
        combinator: 'or',
        children: n.any.map((c) => ({ type: 'condition', ...c })),
      }
    : { type: 'condition', ...n };

/** An AND group of conditions (or groups of alternatives), as the JSON text of the `rules` filter. */
const rulesOf = (...nodes: Node[]): string =>
  JSON.stringify({ type: 'group', combinator: 'and', children: nodes.map(node) });

/** Not seen for `n` days, a contact nobody has been in touch with yet included. */
const quietFor = (n: number): Node => ({
  any: [
    days('lastActivityAt', 'more_than_days_ago', n),
    { field: 'lastActivityAt', operator: 'is_empty' },
  ],
});

const days = (field: string, operator: 'in_last_days' | 'more_than_days_ago', value: number) => ({
  field,
  operator,
  value,
});

/** The filters a built-in view stands for. `meId` is the signed-in person (for "My contacts"). */
export function presetFilters(preset: PresetView, meId: string): Partial<ContactFilters> {
  switch (preset) {
    case 'myContacts':
      return { owner: meId };
    case 'unassigned':
      return { owner: UNASSIGNED_OWNER };
    case 'uncontacted':
      return { rules: rulesOf({ field: 'uncontacted', operator: 'is_true' }) };
    case 'hotLeads':
      // A lead score in the "hot" band of the score badge (67 and up).
      return { rules: rulesOf({ field: 'leadScore', operator: 'gte', value: HOT_FROM }) };
    case 'newThisWeek':
      return { rules: rulesOf(days('createdAt', 'in_last_days', 7)) };
    case 'newLastWeek':
      return {
        rules: rulesOf(
          days('createdAt', 'in_last_days', 14),
          days('createdAt', 'more_than_days_ago', 7),
        ),
      };
    case 'recentlyCreated':
      return { rules: rulesOf(days('createdAt', 'in_last_days', 30)) };
    case 'recentlyModified':
      return { rules: rulesOf(days('updatedAt', 'in_last_days', 30)) };
    case 'recentlyImported':
      return { imported: true, rules: rulesOf(days('createdAt', 'in_last_days', 30)) };
    case 'neverContacted':
      return { rules: rulesOf({ field: 'lastActivityAt', operator: 'is_empty' }) };
    case 'needsFollowUp':
      return {
        rules: rulesOf(quietFor(7), { field: 'unsubscribed', operator: 'is_false' }),
      };
    case 'active':
      return { rules: rulesOf(days('lastActivityAt', 'in_last_days', 30)) };
    case 'inactive':
      return { rules: rulesOf(quietFor(30)) };
    case 'unsubscribed':
      return { consent: 'unsubscribed' };
    case 'minors':
      // Flagged as a minor (BL-190): the same condition the "Add condition" builder writes for the field "Minor".
      return { rules: rulesOf({ field: 'minor', operator: 'is_true' }) };
  }
}

/** The built-in view whose conditions are on screen now (paging, page size and sort order aside), or null. */
export function activePreset(filters: ContactFilters, meId: string): PresetView | null {
  for (const p of PRESET_VIEWS) {
    const want: ContactFilters = {
      ...DEFAULT_FILTERS,
      ...presetFilters(p, meId),
      limit: filters.limit,
      page: filters.page,
      // Sorting a column does not leave the view.
      sort: filters.sort,
      order: filters.order,
    };
    if (sameFilters(filters, want)) return p;
  }
  return null;
}

/** Where the favourite built-in views are kept (per browser; a built-in view is not a stored row, so it has no server flag). */
export const PRESET_FAVORITES_KEY = 'contacts.presetFavorites';

/** The favourite built-in views in a stored comma-separated value; anything unknown is dropped. */
export function parsePresetFavorites(raw: string | null): PresetView[] {
  if (!raw) return [];
  const known: readonly string[] = PRESET_VIEWS;
  return [...new Set(raw.split(','))].filter((k): k is PresetView => known.includes(k));
}

/** The stored value after `preset` is added to or removed from the favourites. */
export function togglePresetFavorite(raw: string | null, preset: PresetView): string {
  const now = parsePresetFavorites(raw);
  return (now.includes(preset) ? now.filter((p) => p !== preset) : [...now, preset]).join(',');
}
