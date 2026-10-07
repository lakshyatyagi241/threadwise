import {
  FLB_COND_MAX_DEPTH,
  FLB_COND_MAX_RULES,
  flbCondRuleCount,
  flbCondTreeFromFlat,
  flbIsCondGroup,
  flbSanitizeConditionGroup,
  type FlbCondGroup,
  type FlbCondItem,
  type FlbCondRule,
} from '@crm/contracts';

/**
 * Pure edits of the Condition node's nested tree (beyond WaDesk). A `path` is the list of item indexes from the root group down to
 * the group or rule being edited; `[]` is the root. Every function returns a new tree and never mutates its input.
 */
export type CondPath = readonly number[];

export const blankRule = (): FlbCondRule => ({ variable: '', operator: 'equals', value: '' });

/**
 * The tree a node edits: its saved `conditionGroup` when it has one, else the flat chain converted to an equal tree (`from: 'flat'`,
 * written back as `conditionGroup` on the first edit). A flat chain that cannot be expressed within the depth / rule limits comes
 * back as `null` so the form keeps the flat editor for it.
 */
export function conditionTreeOf(
  data: Record<string, unknown>,
): { tree: FlbCondGroup; from: 'tree' | 'flat' } | null {
  const saved = flbSanitizeConditionGroup(data.conditionGroup);
  if (saved) return { tree: saved, from: 'tree' };
  const converted = flbCondTreeFromFlat(
    Array.isArray(data.conditions) ? data.conditions : [],
    Array.isArray(data.operators) ? data.operators : [],
  );
  return converted ? { tree: converted, from: 'flat' } : null;
}

function edit(
  g: FlbCondGroup,
  path: CondPath,
  fn: (target: FlbCondItem) => FlbCondItem | null,
): FlbCondGroup {
  if (path.length === 0) return (fn(g) as FlbCondGroup | null) ?? g;
  const [head, ...rest] = path;
  const items: FlbCondItem[] = [];
  g.items.forEach((it, i) => {
    if (i !== head) return void items.push(it);
    if (rest.length === 0) {
      const next = fn(it);
      if (next) items.push(next);
    } else if (flbIsCondGroup(it)) items.push(edit(it, rest, fn));
    else items.push(it);
  });
  return { ...g, items };
}

export const setGroupOp = (g: FlbCondGroup, path: CondPath, op: 'and' | 'or') =>
  edit(g, path, (t) => (flbIsCondGroup(t) ? { ...t, op } : t));

export const patchRule = (g: FlbCondGroup, path: CondPath, patch: Partial<FlbCondRule>) =>
  edit(g, path, (t) => (flbIsCondGroup(t) ? t : { ...t, ...patch }));

export const removeAt = (g: FlbCondGroup, path: CondPath): FlbCondGroup =>
  path.length === 0 ? g : edit(g, path, () => null);

/** Depth of the group at `path` (the root is 1). */
export const depthAt = (path: CondPath): number => path.length + 1;

export const canAddRule = (g: FlbCondGroup): boolean => flbCondRuleCount(g) < FLB_COND_MAX_RULES;
/** A group may only be added inside a group that is shallower than the limit, and while a rule slot is free is not required (an empty group holds no rule). */
export const canAddGroup = (path: CondPath): boolean => depthAt(path) < FLB_COND_MAX_DEPTH;

export const addRule = (g: FlbCondGroup, path: CondPath): FlbCondGroup =>
  canAddRule(g)
    ? edit(g, path, (t) => (flbIsCondGroup(t) ? { ...t, items: [...t.items, blankRule()] } : t))
    : g;

/** A new group starts with one blank rule (if a rule slot is free), so it is not flagged empty the moment it appears. */
export const addGroup = (g: FlbCondGroup, path: CondPath): FlbCondGroup =>
  canAddGroup(path)
    ? edit(g, path, (t) =>
        flbIsCondGroup(t)
          ? {
              ...t,
              items: [
                ...t.items,
                { op: 'and', items: canAddRule(g) ? [blankRule()] : [] } as FlbCondGroup,
              ],
            }
          : t,
      )
    : g;
