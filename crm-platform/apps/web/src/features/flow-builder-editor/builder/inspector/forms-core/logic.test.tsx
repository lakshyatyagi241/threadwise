import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConditionForm } from './logic';
import type { FormProps } from '../types';

// Messages are not loaded here: the key is the text, and a key with params keeps them (functions, i.e. rich tags, drop out).
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key;
    t.rich = t;
    return t;
  },
}));

const rule = (variable: string, operator = 'equals', value = 'x') => ({
  variable,
  operator,
  value,
});
const render = (data: Record<string, unknown>) => {
  const props = {
    node: { id: 'n', type: 'condition', x: 0, y: 0, data },
    data,
    set: () => undefined,
    setMany: () => undefined,
  } as unknown as FormProps;
  return renderToStaticMarkup(ConditionForm(props) as ReactNode);
};
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('ConditionForm group editor', () => {
  const tree = {
    op: 'and',
    items: [
      rule('plan', 'equals', 'pro'),
      { op: 'or', items: [rule('age', 'gt', '18'), rule('city')] },
    ],
  };

  it('renders each group with AND/OR, rules, nesting border, buttons and a summary', () => {
    const html = render({ conditionGroup: tree });
    expect(count(html, /data-cond-group=/g)).toBe(2);
    expect(count(html, /ruleLabel/g)).toBe(3);
    expect(html).toContain('border-s-2');
    expect(count(html, />\s*\+ addRule</g) + count(html, /\+ <!-- -->addRule/g)).toBe(2);
    expect(html).toContain('addGroup');
    expect(html).toContain('removeGroup');
    expect(html).toContain(
      '{{plan}} = pro contracts.cond.and ({{age}} &gt; 18 contracts.cond.or {{city}} = x)',
    );
  });

  it('disables Add group at depth 3 and Add rule at 20 rules', () => {
    const deep = { op: 'and', items: [{ op: 'and', items: [{ op: 'and', items: [rule('a')] }] }] };
    const html = render({ conditionGroup: deep });
    expect(count(html, /disabled=""[^>]*>\+ (<!-- -->)?addGroup/g)).toBe(1);
    const full = { op: 'and', items: Array.from({ length: 20 }, (_, i) => rule(`v${i}`)) };
    const f = render({ conditionGroup: full });
    expect(count(f, /disabled=""[^>]*>\+ (<!-- -->)?addRule/g)).toBe(1);
  });

  it('flags a rule with no variable and an empty group', () => {
    const html = render({
      conditionGroup: { op: 'and', items: [rule(''), { op: 'or', items: [] }] },
    });
    expect(html).toContain('pickVariable');
    expect(html).toContain('emptyGroupWarning');
    expect(html).toContain('problemRules {&quot;count&quot;:1}');
    expect(html).toContain('problemGroups {&quot;count&quot;:1}');
    expect(render({ conditionGroup: tree })).not.toContain('pickVariable');
  });

  it('shows a flat node as the equal tree before it is edited', () => {
    const html = render({
      conditions: [rule('a'), rule('b'), rule('c')],
      operators: ['OR', 'AND'],
    });
    expect(html).toContain('&quot;flat&quot;:&quot;true&quot;');
    expect(html).toContain('({{a}} = x contracts.cond.or {{b}} = x) contracts.cond.and {{c}} = x');
    expect(count(html, /data-cond-group=/g)).toBe(2);
  });

  it('keeps the flat editor for a chain that does not fit the tree limits', () => {
    const rules = Array.from({ length: 6 }, (_, i) => rule(`v${i}`));
    const html = render({ conditions: rules, operators: ['OR', 'AND', 'OR', 'AND', 'OR'] });
    expect(html).not.toContain('data-cond-group');
    expect(html).not.toContain('addGroup');
    expect(html).toContain('ruleLabel {&quot;n&quot;:6}');
  });
});
