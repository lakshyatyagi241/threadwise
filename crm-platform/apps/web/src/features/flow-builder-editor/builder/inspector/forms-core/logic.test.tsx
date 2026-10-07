import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConditionForm } from './logic';
import type { FormProps } from '../types';

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
    expect(count(html, /Rule \d/g)).toBe(3);
    expect(html).toContain('border-l-2');
    expect(count(html, />\s*\+ Add rule</g) + count(html, /\+ <!-- -->Add rule/g)).toBe(2);
    expect(html).toContain('Add group');
    expect(html).toContain('Remove group');
    expect(html).toContain('{{plan}} = pro AND ({{age}} &gt; 18 OR {{city}} = x)');
  });

  it('disables Add group at depth 3 and Add rule at 20 rules', () => {
    const deep = { op: 'and', items: [{ op: 'and', items: [{ op: 'and', items: [rule('a')] }] }] };
    const html = render({ conditionGroup: deep });
    expect(count(html, /disabled=""[^>]*>\+ (<!-- -->)?Add group/g)).toBe(1);
    const full = { op: 'and', items: Array.from({ length: 20 }, (_, i) => rule(`v${i}`)) };
    const f = render({ conditionGroup: full });
    expect(count(f, /disabled=""[^>]*>\+ (<!-- -->)?Add rule/g)).toBe(1);
  });

  it('flags a rule with no variable and an empty group', () => {
    const html = render({
      conditionGroup: { op: 'and', items: [rule(''), { op: 'or', items: [] }] },
    });
    expect(html).toContain('Pick the variable to test.');
    expect(html).toContain('always false');
    expect(html).toContain('1 rule(s) have no variable.');
    expect(html).toContain('1 empty group(s).');
    expect(render({ conditionGroup: tree })).not.toContain('Pick the variable');
  });

  it('shows a flat node as the equal tree before it is edited', () => {
    const html = render({
      conditions: [rule('a'), rule('b'), rule('c')],
      operators: ['OR', 'AND'],
    });
    expect(html).toContain('still uses the old flat list');
    expect(html).toContain('({{a}} = x OR {{b}} = x) AND {{c}} = x');
    expect(count(html, /data-cond-group=/g)).toBe(2);
  });

  it('keeps the flat editor for a chain that does not fit the tree limits', () => {
    const rules = Array.from({ length: 6 }, (_, i) => rule(`v${i}`));
    const html = render({ conditions: rules, operators: ['OR', 'AND', 'OR', 'AND', 'OR'] });
    expect(html).not.toContain('data-cond-group');
    expect(html).not.toContain('Add group');
    expect(html).toContain('Rule 6');
  });
});
