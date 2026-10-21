import { collectConditions, type RoutingRule, type SegmentGroup } from '@crm/contracts';

/** One line of "When": a message key under `rules.when` and its values. */
export interface WhenChip {
  key:
    | 'contact'
    | 'contactNew'
    | 'contactReturning'
    | 'channels'
    | 'keywords'
    | 'keywordsAll'
    | 'languages'
    | 'inside'
    | 'outside'
    | 'always';
  values: Record<string, string | number>;
}

/**
 * The conditions of a rule as the short lines the list shows. A rule that applies to every conversation (its switch is off) shows
 * "Every new conversation" whatever conditions are kept on file; so does a rule with none.
 */
export function whenChips(rule: RoutingRule, channelLabel: (kind: string) => string): WhenChip[] {
  const c = rule.conditions;
  if (rule.appliesToAll) return [{ key: 'always', values: {} }];
  const out: WhenChip[] = [];
  if (c.contactKind === 'new') out.push({ key: 'contactNew', values: {} });
  if (c.contactKind === 'returning') out.push({ key: 'contactReturning', values: {} });
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

/** "Alice, Bob and 2 more": the first `max` names, then a count. Unknown ids (no right to read the people) count as "others". */
export function namesSummary(names: readonly string[], max = 3): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}
