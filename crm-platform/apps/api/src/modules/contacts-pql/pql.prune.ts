import {
  checkConditionValue,
  type SegmentFieldKind,
  type SegmentGroup,
  type SegmentNode,
} from '@crm/contracts';
import type { PqlCatalog } from './pql.prompt';

/**
 * Drops every condition that points at something this workspace does not have (an id or key the model made up). The compiler would
 * answer such a condition with "matches nothing", which would make the whole search look empty; dropping it and saying so is honest.
 * A group left with no children is dropped too; null when nothing is left.
 */
export function pruneRules(
  root: SegmentGroup,
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

  const keep = (n: SegmentNode): SegmentNode | null => {
    if (n.type === 'condition') {
      if (n.field.startsWith('custom.') || n.field.startsWith('company.')) {
        // The key must exist AND the operator and value must fit its kind: otherwise the compiler would answer "matches nothing".
        const kind = known.custom.get(n.field);
        if (!kind || checkConditionValue(kind, n.operator, n.value) !== null) {
          dropped.push(n.field);
          return null;
        }
      }
      const refs = refSet(n.field);
      if (refs && !values(n.value).every((v) => typeof v === 'string' && refs.has(v))) {
        dropped.push(n.field);
        return null;
      }
      return n;
    }
    const children = n.children.map(keep).filter((c): c is SegmentNode => c !== null);
    return children.length > 0 ? { ...n, children } : null;
  };
  const out = keep(root);
  return { rules: out && out.type === 'group' ? out : null, dropped };
}
