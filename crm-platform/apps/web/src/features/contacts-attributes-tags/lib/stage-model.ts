import { lifecycleStageSchema, type StatusOptionResponse } from '@crm/contracts';
import { suggestKey } from './attribute-model';
import { titleCaseKey } from './contact-model';
import { FALLBACK_STATUSES } from './contact-model';

/**
 * Pure rules of the "Contact stages" screen: which option groups it manages, colours, value keys, ordering, and the
 * seeds used when a workspace has not configured anything yet (the pickers then fall back to the platform's lists).
 */

export const STAGE_GROUP = 'lifecycle_stage';
export const STATUS_GROUP = 'status';
export type OptionGroup = typeof STAGE_GROUP | typeof STATUS_GROUP;

/** The group names the contact pickers also accept for statuses (`option-sets.ts`). */
export const GROUP_ALIASES: Record<OptionGroup, readonly string[]> = {
  [STAGE_GROUP]: [STAGE_GROUP],
  [STATUS_GROUP]: [STATUS_GROUP, 'contact_status'],
};

export const LABEL_MAX = 255;
export const VALUE_MAX = 100;

/** Stage colours: progress stages cool to warm, the end states green and red; anything else gets a stable hue. */
const STAGE_COLOR: Record<string, string> = {
  new: '#0284c7',
  contacted: '#4f46e5',
  qualified: '#7c3aed',
  application_started: '#0d9488',
  application_submitted: '#0891b2',
  interview_scheduled: '#d97706',
  offer_received: '#c026d3',
  admission_confirmed: '#16a34a',
  enrolled: '#15803d',
  lost: '#dc2626',
};
const CUSTOM_COLORS = ['#0284c7', '#7c3aed', '#0d9488', '#d97706', '#c026d3', '#4f46e5'];

/** The swatches offered when picking a colour. */
export const COLOR_PALETTE = [
  '#0284c7',
  '#4f46e5',
  '#7c3aed',
  '#c026d3',
  '#dc2626',
  '#d97706',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#64748b',
] as const;

export const isHexColor = (s: string | null | undefined): s is string =>
  typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

/** The colour of a stage value when none is configured. */
export function stageColor(value: string): string {
  const known = STAGE_COLOR[value];
  if (known) return known;
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CUSTOM_COLORS[h % CUSTOM_COLORS.length]!;
}

/** The colour an option is drawn in: its own when set and valid, else the stable fallback for its value. */
export function optionColor(o: { value: string; color?: string | null }): string {
  return isHexColor(o.color) ? o.color : stageColor(o.value);
}

/** The options of a group (any accepted alias), in their saved order. */
export function groupOptions(
  options: readonly StatusOptionResponse[] | undefined,
  group: OptionGroup,
): StatusOptionResponse[] {
  return (options ?? [])
    .filter((o) => GROUP_ALIASES[group].includes(o.optionGroup))
    .sort((a, b) => a.position - b.position);
}

export type LabelProblem = 'required' | 'tooLong' | 'taken';

/** A label must be filled, fit the column, and differ (ignoring case) from every other option of the group. */
export function checkLabel(
  label: string,
  others: readonly { id: string; label: string }[],
  selfId?: string,
): LabelProblem | null {
  const l = label.trim();
  if (!l) return 'required';
  if (l.length > LABEL_MAX) return 'tooLong';
  const lower = l.toLocaleLowerCase();
  if (others.some((o) => o.id !== selfId && o.label.trim().toLocaleLowerCase() === lower))
    return 'taken';
  return null;
}

/**
 * The stored value key for a new option, from its label ("Won over" -> "won_over"). A label with no Latin letters
 * (Arabic, say) gets `fallback`; a key already taken in the group gets a numeric suffix.
 */
export function valueFromLabel(
  label: string,
  taken: Iterable<string>,
  fallback = 'option',
): string {
  const used = new Set(taken);
  const base = (suggestKey(label) || fallback).slice(0, VALUE_MAX - 4);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A new list with the item at `from` moved to `to` (both clamped); the same list when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const end = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === end) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(end, 0, item!);
  return next;
}

export const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export interface SeedOption {
  value: string;
  label: string;
  color: string;
  isDefault: boolean;
}

/** The platform's ten lifecycle stages, offered as the starting list of a workspace that has none. */
export function stageSeeds(): SeedOption[] {
  return lifecycleStageSchema.options.map((value) => ({
    value,
    label: titleCaseKey(value),
    color: stageColor(value),
    isDefault: value === 'new',
  }));
}

/** The platform's four contact statuses, with labels from the caller (they are translated). */
export function statusSeeds(label: (value: string) => string): SeedOption[] {
  return FALLBACK_STATUSES.map((value, i) => ({
    value,
    label: label(value),
    color: COLOR_PALETTE[[7, 0, 1, 2][i]!]!,
    isDefault: false,
  }));
}

/** Where contacts holding an option can go when it is deleted: the other options of the group. */
export const moveTargets = <T extends { id: string }>(options: readonly T[], id: string): T[] =>
  options.filter((o) => o.id !== id);

/** What deleting an option needs first: nothing, or a place to move the contacts that hold it. */
export const deleteNeeds = (holders: number): 'nothing' | 'move' =>
  holders > 0 ? 'move' : 'nothing';
