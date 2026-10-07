import {
  EMPTY_WIZARD_AUDIENCE,
  segmentRulesSchema,
  wizardAudienceHasSource,
  type SegmentGroup,
  type WizardAudience,
  type WizardAudienceSources,
} from '@crm/contracts';
import { fromWire, parseRules, toWire } from '@/features/segments/lib/wire';
import type { FieldDef } from '@/features/segments/lib/fields';
import { countConditions, pruneIncomplete, type Group } from '@/features/segments/lib/model';
import { kindLookup } from '@/features/segments/lib/fields';

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** The condition builder's tree as the draft holds it: the complete conditions only; null when there are none. */
export function rulesFromEditor(root: Group, catalog: readonly FieldDef[]): SegmentGroup | null {
  const wire = toWire(root, catalog);
  if (wire.children.length === 0) return null;
  return parseRules(wire);
}

export const editorFromRules = (rules: SegmentGroup | null | undefined): Group => fromWire(rules);

/** How many conditions are left out of the draft because they are not finished. */
export function incompleteCount(root: Group, catalog: readonly FieldDef[]): number {
  return pruneIncomplete(root, kindLookup(catalog)).dropped;
}

/** The audience as it is sent to the count, the check and the preview; null when nothing selects anyone yet. */
export function countableAudience(a: WizardAudience): WizardAudience | null {
  if (!wizardAudienceHasSource(a)) return null;
  const rules = a.rules ? segmentRulesSchema.safeParse(a.rules) : null;
  return { ...EMPTY_WIZARD_AUDIENCE, ...a, rules: rules?.success ? rules.data : null };
}

export interface AudienceNames {
  groups: Array<{ id: string; name: string; found: boolean }>;
  segments: Array<{ id: string; name: string; found: boolean }>;
}

/** The chosen groups and segments by name; one that no longer exists keeps its place and is flagged. */
export function audienceNames(
  a: WizardAudience,
  sources: WizardAudienceSources | undefined,
): AudienceNames {
  const pick = (
    ids: readonly string[],
    list: ReadonlyArray<{ id: string; name: string }> | undefined,
  ) =>
    ids.map((id) => {
      const hit = list?.find((x) => x.id === id);
      return { id, name: hit?.name ?? id, found: Boolean(hit) };
    });
  return {
    groups: pick(a.groupIds, sources?.groups),
    segments: pick(a.segmentIds, sources?.segments),
  };
}

/** What a Contact Hub selection stands for, in the two shapes the Hub sends: the ticked rows, or the view's filter minus the un-ticked rows. */
export function selectionKind(
  s: NonNullable<WizardAudience['selection']>,
): { kind: 'ids'; count: number } | { kind: 'filter'; excluded: number } {
  return s.ids !== undefined
    ? { kind: 'ids', count: s.ids.length }
    : { kind: 'filter', excluded: s.excludeIds?.length ?? 0 };
}

export const conditionTotal = (rules: SegmentGroup | null): number =>
  rules ? countConditions(fromWire(rules)) : 0;
