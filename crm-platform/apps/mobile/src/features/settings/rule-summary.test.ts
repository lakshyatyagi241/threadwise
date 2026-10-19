import { ASHA, SALES_TEAM, fallback, pricing, spamRule } from '@/test/routing-fixtures';
import { namesSummary, targetNames, whenChips } from './rule-summary';

const channel = (kind: string) => `ch:${kind}`;

describe('whenChips', () => {
  it('lists each condition of a rule', () => {
    expect(whenChips(pricing, channel)).toEqual([
      { key: 'channels', values: { list: 'ch:whatsapp_cloud' } },
      { key: 'keywords', values: { list: 'price, cost' } },
      { key: 'languages', values: { list: 'en' } },
      { key: 'inside', values: {} },
    ]);
  });

  it('tells "all of" from "any of" for keywords, and outside from inside business hours', () => {
    const rule = {
      ...spamRule,
      conditions: { ...spamRule.conditions, businessHours: 'outside' as const },
    };
    expect(whenChips(rule, channel)).toEqual([
      { key: 'keywordsAll', values: { list: 'win, prize' } },
      { key: 'outside', values: {} },
    ]);
  });

  it('counts the contact conditions', () => {
    const rule = {
      ...pricing,
      conditions: {
        ...pricing.conditions,
        channelKinds: [],
        keywords: null,
        languages: [],
        businessHours: 'any' as const,
        contact: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition' }, { type: 'condition' }],
        },
      },
    } as unknown as typeof pricing;
    expect(whenChips(rule, channel)).toEqual([{ key: 'contact', values: { count: 2 } }]);
  });

  it('says "always" for a rule with no condition (the fallback)', () => {
    expect(whenChips(fallback, channel)).toEqual([{ key: 'always', values: {} }]);
  });
});

describe('namesSummary', () => {
  it('shows the first names and counts the rest', () => {
    expect(namesSummary(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
    expect(namesSummary(['a'])).toEqual({ shown: ['a'], more: 0 });
  });
});

describe('targetNames', () => {
  it('puts names to the agents and teams a rule hands conversations to, and a stand-in for an id nobody can name', () => {
    const names = new Map([
      [ASHA, 'Asha Verma'],
      [SALES_TEAM, 'Sales'],
    ]);
    expect(targetNames(pricing, names, 'an agent')).toEqual(['Asha Verma', 'an agent']);
    expect(targetNames(fallback, names, 'an agent')).toEqual(['Sales']);
    expect(targetNames(spamRule, names, 'an agent')).toEqual([]);
  });
});
