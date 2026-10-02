import {
  SEGMENT_MAX_CONDITIONS,
  SEGMENT_MAX_DEPTH,
  SEGMENT_MAX_GROUP_CHILDREN,
  parseDateValue,
} from '@crm/contracts';
import {
  MAX_LIST_VALUES,
  MAX_RELATIVE_DAYS,
  MAX_TEXT_VALUE,
  inputKindOf,
  type FieldKind,
  type InputKind,
  type Operator,
} from './operators';

/**
 * The rule tree the builder edits: groups that join their children with AND or OR, and conditions over one contact
 * field. Every function here is pure and returns a new tree (or the same one when nothing changed), so the builder is a
 * plain reducer over it and the rules are testable without a browser.
 *
 * Limits are the contract's: at most 3 levels of groups (the root is level 1), 50 conditions, 50 children per group.
 */

export const MAX_DEPTH = SEGMENT_MAX_DEPTH;
export const MAX_CONDITIONS = SEGMENT_MAX_CONDITIONS;
export const MAX_GROUP_CHILDREN = SEGMENT_MAX_GROUP_CHILDREN;

export type Combinator = 'and' | 'or';

/** What a condition holds while it is edited; numbers and dates stay text until the rules are saved. */
export type EditorValue = null | string | boolean | string[] | { from: string; to: string };

export interface Condition {
  kind: 'condition';
  /** Local identity (React keys, error targets); never sent to the server. */
  id: string;
  field: string;
  operator: Operator;
  value: EditorValue;
}

export interface Group {
  kind: 'group';
  id: string;
  combinator: Combinator;
  children: RuleNode[];
}

export type RuleNode = Condition | Group;

let seq = 0;
export const nextId = (): string => `n${++seq}`;

export function emptyRoot(): Group {
  return { kind: 'group', id: nextId(), combinator: 'and', children: [] };
}

/** The empty value a fresh input of this shape starts with. */
export function defaultValue(kind: InputKind): EditorValue {
  switch (kind) {
    case 'none':
      return null;
    case 'pick':
    case 'tokens':
    case 'numberTokens':
      return [];
    case 'numberRange':
    case 'dateRange':
      return { from: '', to: '' };
    default:
      return '';
  }
}

/** What the condition builder needs to know of a field to build a condition. */
export interface FieldShape {
  id: string;
  kind: FieldKind;
  operators: readonly Operator[];
}

export function newCondition(field: FieldShape): Condition {
  const operator = field.operators[0] ?? 'equals';
  return {
    kind: 'condition',
    id: nextId(),
    field: field.id,
    operator,
    value: defaultValue(inputKindOf(field.kind, operator)),
  };
}

// --- reading the tree -------------------------------------------------------------------------------------------

export function countConditions(node: RuleNode): number {
  return node.kind === 'condition'
    ? 1
    : node.children.reduce((sum, c) => sum + countConditions(c), 0);
}

/** Levels of groups: an empty root is 1, a group inside it 2. */
export function treeDepth(node: RuleNode): number {
  if (node.kind === 'condition') return 0;
  return 1 + node.children.reduce((deepest, c) => Math.max(deepest, treeDepth(c)), 0);
}

export function findNode(root: Group, id: string): RuleNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    if (child.id === id) return child;
    if (child.kind === 'group') {
      const hit = findNode(child, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** 1 for the root, 2 for a group inside it. -1 when the id is not in the tree. */
export function levelOf(root: Group, id: string, level = 1): number {
  if (root.id === id) return level;
  for (const child of root.children) {
    if (child.id === id) return level + 1;
    if (child.kind === 'group') {
      const hit = levelOf(child, id, level + 1);
      if (hit !== -1) return hit;
    }
  }
  return -1;
}

export const canAddCondition = (root: Group, groupId?: string): boolean => {
  if (countConditions(root) >= MAX_CONDITIONS) return false;
  const group = groupId ? findNode(root, groupId) : root;
  return group?.kind === 'group' ? group.children.length < MAX_GROUP_CHILDREN : false;
};

/** A group can be added inside `groupId` while the new group (and the condition it starts with) still fit the limits. */
export function canAddGroup(root: Group, groupId: string): boolean {
  const level = levelOf(root, groupId);
  return level !== -1 && level < MAX_DEPTH && canAddCondition(root, groupId);
}

// --- editing the tree -------------------------------------------------------------------------------------------

function mapGroup(group: Group, id: string, fn: (g: Group) => Group): Group {
  if (group.id === id) return fn(group);
  let changed = false;
  const children = group.children.map((c) => {
    if (c.kind !== 'group') return c;
    const next = mapGroup(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...group, children } : group;
}

function mapCondition(group: Group, id: string, fn: (c: Condition) => Condition): Group {
  let changed = false;
  const children = group.children.map((c) => {
    if (c.kind === 'group') {
      const next = mapCondition(c, id, fn);
      if (next !== c) changed = true;
      return next;
    }
    if (c.id !== id) return c;
    const next = fn(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...group, children } : group;
}

/** Appends a condition to a group. Returns the same tree when the 50-condition limit is reached. */
export function addCondition(root: Group, groupId: string, condition: Condition): Group {
  if (!canAddCondition(root, groupId)) return root;
  return mapGroup(root, groupId, (g) => ({ ...g, children: [...g.children, condition] }));
}

/**
 * Appends a group (opposite combinator to its parent, starting with `seed` so it is never empty). Returns the same
 * tree at the depth or condition limit.
 */
export function addGroup(root: Group, parentId: string, seed: Condition): Group {
  if (!canAddGroup(root, parentId)) return root;
  return mapGroup(root, parentId, (g) => ({
    ...g,
    children: [
      ...g.children,
      {
        kind: 'group',
        id: nextId(),
        combinator: g.combinator === 'and' ? 'or' : 'and',
        children: [seed],
      },
    ],
  }));
}

export function setCombinator(root: Group, groupId: string, combinator: Combinator): Group {
  return mapGroup(root, groupId, (g) => (g.combinator === combinator ? g : { ...g, combinator }));
}

function without(group: Group, id: string): Group {
  const children: RuleNode[] = [];
  let changed = false;
  for (const c of group.children) {
    if (c.id === id) {
      changed = true;
      continue;
    }
    if (c.kind === 'group') {
      const next = without(c, id);
      if (next !== c) {
        changed = true;
        // A nested group that lost its last condition goes with it: an empty group matches nothing useful.
        if (next.children.length === 0) continue;
      }
      children.push(next);
    } else children.push(c);
  }
  return changed ? { ...group, children } : group;
}

/** Removes a condition or a group. The root cannot be removed; a nested group emptied by it is removed too. */
export function removeNode(root: Group, id: string): Group {
  return id === root.id ? root : without(root, id);
}

/** Replaces a condition's field: the operator and the value start over, because they belonged to the old field. */
export function changeField(root: Group, conditionId: string, field: FieldShape): Group {
  return mapCondition(root, conditionId, (c) => {
    if (c.field === field.id) return c;
    const operator = field.operators[0] ?? 'equals';
    return {
      ...c,
      field: field.id,
      operator,
      value: defaultValue(inputKindOf(field.kind, operator)),
    };
  });
}

/** What the old value becomes under a new operator: kept when the input has the same shape, converted where it is natural. */
export function convertValue(value: EditorValue, from: InputKind, to: InputKind): EditorValue {
  if (from === to) return value;
  const isList = (k: InputKind) => k === 'pick' || k === 'tokens' || k === 'numberTokens';
  const single = (k: InputKind) => k === 'one' || k === 'text' || k === 'number';
  // one value <-> a list of the same sort of values keeps what was chosen
  const pair = (one: InputKind, many: InputKind) =>
    (from === one && to === many) || (from === many && to === one);
  const sameSort = pair('one', 'pick') || pair('text', 'tokens') || pair('number', 'numberTokens');
  if (single(from) && isList(to)) {
    return sameSort && typeof value === 'string' && value ? [value] : [];
  }
  if (isList(from) && single(to)) {
    return sameSort && Array.isArray(value) ? (value[0] ?? '') : '';
  }
  if (typeof value === 'string' && value !== '') {
    // a typed number survives a switch between number-like inputs
    if ((from === 'number' || from === 'days') && (to === 'number' || to === 'days')) return value;
  }
  return defaultValue(to);
}

export function changeOperator(
  root: Group,
  conditionId: string,
  field: FieldShape,
  operator: Operator,
): Group {
  return mapCondition(root, conditionId, (c) => {
    if (c.operator === operator) return c;
    const from = inputKindOf(field.kind, c.operator);
    const to = inputKindOf(field.kind, operator);
    return { ...c, operator, value: convertValue(c.value, from, to) };
  });
}

export function setValue(root: Group, conditionId: string, value: EditorValue): Group {
  return mapCondition(root, conditionId, (c) => (c.value === value ? c : { ...c, value }));
}

/** Moves a node one place up (-1) or down (+1) among its siblings. */
export function moveNode(root: Group, id: string, direction: -1 | 1): Group {
  const parent = findParent(root, id);
  if (!parent) return root;
  const at = parent.children.findIndex((c) => c.id === id);
  const to = at + direction;
  if (at === -1 || to < 0 || to >= parent.children.length) return root;
  return mapGroup(root, parent.id, (g) => {
    const children = [...g.children];
    [children[at], children[to]] = [children[to]!, children[at]!];
    return { ...g, children };
  });
}

export function findParent(root: Group, id: string): Group | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    if (child.kind === 'group') {
      const hit = findParent(child, id);
      if (hit) return hit;
    }
  }
  return null;
}

// --- completeness -----------------------------------------------------------------------------------------------

export type ValueProblem = 'empty' | 'number' | 'days' | 'date' | 'range' | 'tooLong' | 'tooMany';

const isNum = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
const isDate = (s: string) => parseDateValue(s) !== null;

/** Why a condition cannot be saved yet (null = it is complete). Needs the field kind to know the value's shape. */
export function valueProblem(c: Condition, kind: FieldKind): ValueProblem | null {
  const shape = inputKindOf(kind, c.operator);
  const v = c.value;
  switch (shape) {
    case 'none':
      return null;
    case 'text':
      if (typeof v !== 'string' || v.trim() === '') return 'empty';
      return v.length > MAX_TEXT_VALUE ? 'tooLong' : null;
    case 'one':
      return typeof v === 'string' && v !== '' ? null : 'empty';
    case 'pick':
    case 'tokens':
    case 'numberTokens': {
      if (!Array.isArray(v) || v.length === 0) return 'empty';
      if (v.length > MAX_LIST_VALUES) return 'tooMany';
      if (shape === 'numberTokens' && !v.every(isNum)) return 'number';
      if (shape === 'tokens' && v.some((t) => t.length > MAX_TEXT_VALUE)) return 'tooLong';
      return null;
    }
    case 'number':
      if (typeof v !== 'string' || v.trim() === '') return 'empty';
      return isNum(v) ? null : 'number';
    case 'days': {
      if (typeof v !== 'string' || v.trim() === '') return 'empty';
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= MAX_RELATIVE_DAYS ? null : 'days';
    }
    case 'date':
      if (typeof v !== 'string' || v === '') return 'empty';
      return isDate(v) ? null : 'date';
    case 'numberRange':
    case 'dateRange': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'empty';
      if (v.from === '' || v.to === '') return 'empty';
      if (shape === 'numberRange') {
        if (!isNum(v.from) || !isNum(v.to)) return 'number';
        return Number(v.from) <= Number(v.to) ? null : 'range';
      }
      if (!isDate(v.from) || !isDate(v.to)) return 'date';
      return Date.parse(v.from) <= Date.parse(v.to) ? null : 'range';
    }
  }
}

/** Walks every condition with the kind of its field (`kindOf` returns null for a field that no longer exists). */
export function conditionsOf(root: Group): Condition[] {
  return root.children.flatMap((c) => (c.kind === 'condition' ? [c] : conditionsOf(c)));
}

/**
 * The tree without the conditions that cannot be evaluated yet, and the groups that emptied. The live preview runs on
 * this, so a half-typed condition never makes the preview fail.
 */
export function pruneIncomplete(
  root: Group,
  kindOf: (field: string) => FieldKind | null,
): { tree: Group; dropped: number } {
  let dropped = 0;
  const walk = (g: Group): Group => {
    const children: RuleNode[] = [];
    for (const c of g.children) {
      if (c.kind === 'condition') {
        const kind = kindOf(c.field);
        if (kind === null || valueProblem(c, kind) !== null) dropped++;
        else children.push(c);
      } else {
        const inner = walk(c);
        if (inner.children.length > 0) children.push(inner);
      }
    }
    return { ...g, children };
  };
  return { tree: walk(root), dropped };
}

/** A string that is the same for two trees with the same rules, whatever their local ids (dirty checks, preview keys). */
export function signature(node: RuleNode): string {
  if (node.kind === 'condition') {
    return JSON.stringify(['c', node.field, node.operator, node.value]);
  }
  return JSON.stringify(['g', node.combinator, node.children.map(signature)]);
}
