import {
  SEGMENT_MAX_DEPTH,
  checkConditionValue,
  segmentRulesSchema,
  type SegmentCondition,
  type SegmentFieldKind,
  type SegmentGroup,
  type SegmentNode,
} from '@crm/contracts';
import type { PqlCatalog } from './pql.prompt';

/**
 * Drops every part of the model's tree the workspace or the shared schema cannot use, and names it in `dropped`: a condition the schema
 * refuses on its own (an operator its field does not have, a value of the wrong shape, a tag written as a name instead of its id), a
 * condition that points at an id or key the workspace does not have (an invented one), and a group nested deeper than the schema allows.
 * The compiler would answer such a condition with "matches nothing", which would make the whole search look empty; dropping it and saying
 * so is honest. A group left with no children is dropped too; null when nothing is left.
 */
export function pruneRules(
  root: unknown,
  catalog: PqlCatalog,
): { rules: SegmentGroup | null; dropped: string[] } {
  const known = {
    tags: new Set(catalog.tags.map((t) => t.id)),
    groups: new Set(catalog.groups.map((g) => g.id)),
    owner: new Set(catalog.owners.map((o) => o.id)),
    lifecycleStage: new Set(catalog.stages.map((s) => s.value)),
    status: new Set(catalog.statuses.map((s) => s.value)),
    custom: new Map<string, SegmentFieldKind>([
      ...catalog.customFields.map((f): [string, SegmentFieldKind] => [`custom.${f.key}`, f.kind]),
      ...catalog.companyFields.map((f): [string, SegmentFieldKind] => [`company.${f.key}`, f.kind]),
    ]),
  };
  const dropped: string[] = [];
  const values = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
  const refSet = (field: string): Set<string> | undefined =>
    field === 'tags' ||
    field === 'groups' ||
    field === 'owner' ||
    field === 'lifecycleStage' ||
    field === 'status'
      ? known[field]
      : undefined;

  // Each node is checked on its own, so a bad one is dropped without voiding its siblings. The shape is the model's, so nothing is
  // trusted: a condition is rebuilt from the four fields the schema knows, and the shared schema decides whether it is legal.
  const keepCondition = (n: Record<string, unknown>): SegmentCondition | null => {
    const condition = {
      type: 'condition',
      field: n.field,
      operator: n.operator,
      ...(n.value !== undefined ? { value: n.value } : {}),
    };
    const legal = segmentRulesSchema.safeParse({
      type: 'group',
      combinator: 'and',
      children: [condition],
    });
    if (!legal.success) {
      dropped.push(String(n.field ?? 'condition'));
      return null;
    }
    const kept = condition as SegmentCondition;
    if (kept.field.startsWith('custom.') || kept.field.startsWith('company.')) {
      // The key must exist AND the operator and value must fit its kind: otherwise the compiler would answer "matches nothing".
      const kind = known.custom.get(kept.field);
      if (!kind || checkConditionValue(kind, kept.operator, kept.value) !== null) {
        dropped.push(kept.field);
        return null;
      }
    }
    const refs = refSet(kept.field);
    if (refs && !values(kept.value).every((v) => typeof v === 'string' && refs.has(v))) {
      dropped.push(kept.field);
      return null;
    }
    return kept;
  };

  const keep = (n: unknown, depth: number): SegmentNode | null => {
    if (typeof n !== 'object' || n === null) {
      dropped.push('condition');
      return null;
    }
    const { type, combinator, children } = n as {
      type?: unknown;
      combinator?: unknown;
      children?: unknown;
    };
    if (type === 'condition') return keepCondition(n as Record<string, unknown>);
    if (
      type !== 'group' ||
      depth > SEGMENT_MAX_DEPTH ||
      (combinator !== 'and' && combinator !== 'or') ||
      !Array.isArray(children)
    ) {
      dropped.push('group');
      return null;
    }
    const kept = children
      .map((c) => keep(c, depth + 1))
      .filter((c): c is SegmentNode => c !== null);
    return kept.length > 0 ? { type: 'group', combinator, children: kept } : null;
  };
  const out = keep(root, 1);
  return { rules: out && out.type === 'group' ? out : null, dropped };
}
