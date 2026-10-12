import { describe, expect, it } from 'vitest';
import type { FlbBuilderContext, FlowNode } from '@crm/contracts';
import { renderIntl } from '../test-utils/intl';
import { COND_CARD_MAX, condCardText, NodePreview } from './node-preview';

const rule = (variable: string, operator = 'equals', value = 'x') => ({
  variable,
  operator,
  value,
});
const card = (data: Record<string, unknown>) =>
  renderIntl(
    <NodePreview
      node={{ id: 'n', type: 'condition', x: 0, y: 0, data } as FlowNode}
      ctx={{} as FlbBuilderContext}
    />,
  );

describe('Condition card', () => {
  it('shows the tree with parentheses', () => {
    const html = card({
      conditionGroup: {
        op: 'or',
        items: [rule('a'), { op: 'and', items: [rule('b', 'gt', '3'), rule('c', 'exists')] }],
      },
    });
    expect(html).toContain('{{a}} = x OR ({{b}} &gt; 3 AND {{c}} is set)');
  });

  it('wins over the flat list, and uses ? for blanks', () => {
    const html = card({
      conditions: [rule('flat')],
      conditionGroup: { op: 'and', items: [rule('', 'equals', '')] },
    });
    expect(html).toContain('{{?}} = ?');
    expect(html).not.toContain('flat');
  });

  it('says so for an empty tree, keeps the flat card otherwise, and truncates long summaries', () => {
    expect(card({ conditionGroup: { op: 'and', items: [] } })).toContain('No conditions set');
    expect(card({ conditions: [rule('plan', 'equals', 'pro')] })).toContain('{{plan}}');
    const long = 'x'.repeat(200);
    const text = condCardText(long);
    expect(text).toHaveLength(COND_CARD_MAX);
    expect(text.endsWith('…')).toBe(true);
    expect(condCardText('short')).toBe('short');
  });
});

describe('Answer from FAQ card', () => {
  const faqCard = (data: Record<string, unknown>) =>
    renderIntl(
      <NodePreview
        node={{ id: 'n', type: 'faq', x: 0, y: 0, data } as FlowNode}
        ctx={{} as FlbBuilderContext}
      />,
    );

  it('shows the defaults for a fresh node', () => {
    const html = faqCard({
      query: '{{user_message}}',
      category: '',
      minScore: null,
      sendAnswer: true,
      save: 'faq',
    });
    expect(html).toContain('{{user_message}}');
    expect(html).toContain('All FAQs');
    expect(html).toContain('workspace score');
    expect(html).not.toContain('not sent');
    expect(html).toContain('{{faq}}');
  });

  it('shows the category, its own score, that nothing is sent, and the variable it saves as', () => {
    const html = faqCard({
      query: '{{answer}}',
      category: 'Billing',
      minScore: 0.62,
      sendAnswer: false,
      save: 'kb',
    });
    expect(html).toContain('{{answer}}');
    expect(html).toContain('FAQs: Billing');
    expect(html).toContain('min score 0.62');
    expect(html).not.toContain('workspace score');
    expect(html).toContain('not sent');
    expect(html).toContain('{{kb}}');
  });

  it('copes with a node with no data at all', () => {
    const html = faqCard({});
    expect(html).toContain('{{user_message}}');
    expect(html).toContain('{{faq}}');
  });
});
