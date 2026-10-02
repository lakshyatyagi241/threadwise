import {
  segmentRulesSchema,
  type SegmentCondition,
  type SegmentGroup,
  type SegmentNode,
  type SegmentRules,
  type SegmentValue,
} from '@crm/contracts';
import { kindLookup, type FieldDef } from './fields';
import {
  emptyRoot,
  nextId,
  pruneIncomplete,
  type Condition,
  type EditorValue,
  type Group,
  type RuleNode,
} from './model';
import { inputKindOf } from './operators';

/** The editor tree <-> the rules on the wire. The wire has no ids; numbers and days are real numbers there. */

function toWireValue(c: Condition, catalog: readonly FieldDef[]): SegmentValue | undefined {
  const kind = kindLookup(catalog)(c.field);
  if (!kind) return undefined;
  const v = c.value;
  switch (inputKindOf(kind, c.operator)) {
    case 'none':
      return undefined;
    case 'number':
    case 'days':
      return Number(v);
    case 'numberTokens':
      return Array.isArray(v) ? v.map(Number) : undefined;
    case 'numberRange':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? { from: Number(v.from), to: Number(v.to) }
        : undefined;
    case 'dateRange':
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? { from: v.from, to: v.to }
        : undefined;
    case 'text':
      return typeof v === 'string' ? v.trim() : undefined;
    case 'date':
    case 'one':
      return typeof v === 'string' ? v : undefined;
    case 'pick':
    case 'tokens':
      return Array.isArray(v) ? v : undefined;
  }
}

function groupToWire(g: Group, catalog: readonly FieldDef[]): SegmentGroup {
  return {
    type: 'group',
    combinator: g.combinator,
    children: g.children.map((c): SegmentNode => {
      if (c.kind === 'group') return groupToWire(c, catalog);
      const value = toWireValue(c, catalog);
      const out: SegmentCondition = { type: 'condition', field: c.field, operator: c.operator };
      if (value !== undefined) out.value = value;
      return out;
    }),
  };
}

/** The rules to send: incomplete conditions and the groups they emptied are left out (the preview) or already refused (save). */
export function toWire(root: Group, catalog: readonly FieldDef[]): SegmentGroup {
  return groupToWire(pruneIncomplete(root, kindLookup(catalog)).tree, catalog);
}

/**
 * The rules checked by the contract's own schema (the one the API uses). Null when they would be refused (an empty
 * tree, a group with no children, a value of the wrong shape): the caller then does not call the server with them.
 */
export function parseRules(group: SegmentGroup): SegmentRules | null {
  const r = segmentRulesSchema.safeParse(group);
  return r.success ? r.data : null;
}

function toEditorValue(v: SegmentValue | undefined): EditorValue {
  if (v === undefined) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(String);
  return { from: String(v.from), to: String(v.to) };
}

function nodeFromWire(n: SegmentNode): RuleNode {
  if (n.type === 'group') {
    return {
      kind: 'group',
      id: nextId(),
      combinator: n.combinator,
      children: n.children.map(nodeFromWire),
    };
  }
  return {
    kind: 'condition',
    id: nextId(),
    field: n.field,
    operator: n.operator,
    value: toEditorValue(n.value),
  };
}

export function fromWire(wire: SegmentGroup | null | undefined): Group {
  if (!wire) return emptyRoot();
  return nodeFromWire(wire) as Group;
}

/** The condition at the server's path (`children.1.children.0`; the root is ''), for its `invalidConditions`. */
export function conditionAtPath(root: Group, path: string): Condition | null {
  let node: RuleNode = root;
  for (const m of path.matchAll(/children\.(\d+)/g)) {
    if (node.kind !== 'group') return null;
    const next: RuleNode | undefined = node.children[Number(m[1])];
    if (!next) return null;
    node = next;
  }
  return node.kind === 'condition' ? node : null;
}
