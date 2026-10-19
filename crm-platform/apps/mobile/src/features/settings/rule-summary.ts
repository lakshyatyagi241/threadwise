import { collectConditions, type RoutingRule, type SegmentGroup } from '@crm/contracts';

/** One line of "When": the kind (a message key under `settings.routing.when`) and its values. */
export interface WhenChip {
  key:
    | 'contact'
    | 'channels'
    | 'keywords'
    | 'keywordsAll'
    | 'languages'
    | 'inside'
    | 'outside'
    | 'always';
  values: Record<string, string | number>;
}

/** The conditions of a rule as the short lines the list shows. A rule with none is a catch-all (only the fallback may be one). */
export function whenChips(rule: RoutingRule, channelLabel: (kind: string) => string): WhenChip[] {
  const c = rule.conditions;
  const out: WhenChip[] = [];
  if (c.contact) {
    out.push({
      key: 'contact',
      values: { count: collectConditions(c.contact as SegmentGroup).length },
    });
  }
  if (c.channelKinds.length > 0) {
    out.push({ key: 'channels', values: { list: c.channelKinds.map(channelLabel).join(', ') } });
  }
  if (c.keywords) {
    out.push({
      key: c.keywords.mode === 'all' ? 'keywordsAll' : 'keywords',
      values: { list: c.keywords.words.join(', ') },
    });
  }
  if (c.languages.length > 0) {
    out.push({ key: 'languages', values: { list: c.languages.join(', ') } });
  }
  if (c.businessHours === 'inside') out.push({ key: 'inside', values: {} });
  if (c.businessHours === 'outside') out.push({ key: 'outside', values: {} });
  if (out.length === 0) out.push({ key: 'always', values: {} });
  return out;
}

/** "Alice, Bob and 2 more": the first `max` names, then a count. */
export function namesSummary(names: readonly string[], max = 3): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}

/** The agents and teams a rule hands conversations to, by name (`fallback` for an id nobody can name). */
export function targetNames(
  rule: RoutingRule,
  names: ReadonlyMap<string, string>,
  fallback: string,
): string[] {
  const ids = [...(rule.assign?.userIds ?? []), ...(rule.assign?.teamIds ?? [])];
  return ids.map((id) => names.get(id) ?? fallback);
}
