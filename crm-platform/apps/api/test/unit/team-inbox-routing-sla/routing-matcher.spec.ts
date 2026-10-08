import { describe, expect, it } from 'vitest';
import {
  createRoutingRuleSchema,
  hasRoutingConditions,
  routingConditionsSchema,
  type RoutingConditions,
} from '@crm/contracts';
import {
  keywordsMatch,
  languageMatches,
  matchesFacts,
  type RoutingFacts,
} from '../../../src/modules/team-inbox-routing-sla/routing-matcher';

const facts = (over: Partial<RoutingFacts> = {}): RoutingFacts => ({
  channelKind: 'whatsapp_cloud',
  messageText: 'Hi, I need a REFUND for my order',
  language: 'en',
  outsideHours: false,
  ...over,
});
const cond = (over: Partial<RoutingConditions>): RoutingConditions =>
  routingConditionsSchema.parse(over);

describe('keywords', () => {
  it('matches any of the words, case-insensitively, as a substring', () => {
    const k = { mode: 'any', words: ['refund', 'invoice'] } as const;
    expect(keywordsMatch(k, 'I want my Refund')).toBe(true);
    expect(keywordsMatch(k, 'pricing?')).toBe(false);
  });
  it('"all" needs every word, and a message without text matches nothing', () => {
    const k = { mode: 'all', words: ['refund', 'order'] } as const;
    expect(keywordsMatch(k, 'refund for my order')).toBe(true);
    expect(keywordsMatch(k, 'refund please')).toBe(false);
    expect(keywordsMatch(k, null)).toBe(false);
  });
  it('folds Arabic text without throwing', () => {
    expect(keywordsMatch({ mode: 'any', words: ['استرجاع'] }, 'أريد استرجاع المبلغ')).toBe(true);
  });
});

describe('language', () => {
  it('matches the language and its regional variants, never an unknown one', () => {
    expect(languageMatches(['en'], 'en')).toBe(true);
    expect(languageMatches(['en'], 'en-US')).toBe(true);
    expect(languageMatches(['en'], 'ens')).toBe(false);
    expect(languageMatches(['ar'], null)).toBe(false);
  });
});

describe('matchesFacts', () => {
  it('a part that is not set does not restrict', () => {
    expect(matchesFacts(cond({}), facts())).toBe(true);
  });
  it('every set part must hold', () => {
    const c = cond({
      channelKinds: ['whatsapp_cloud'],
      keywords: { mode: 'any', words: ['refund'] },
      languages: ['en'],
    });
    expect(matchesFacts(c, facts())).toBe(true);
    expect(matchesFacts(c, facts({ channelKind: 'telegram' }))).toBe(false);
    expect(matchesFacts(c, facts({ messageText: 'hello' }))).toBe(false);
    expect(matchesFacts(c, facts({ language: 'ar' }))).toBe(false);
  });
  it('business hours: inside and outside are exclusive', () => {
    expect(matchesFacts(cond({ businessHours: 'outside' }), facts({ outsideHours: true }))).toBe(
      true,
    );
    expect(matchesFacts(cond({ businessHours: 'outside' }), facts({ outsideHours: false }))).toBe(
      false,
    );
    expect(matchesFacts(cond({ businessHours: 'inside' }), facts({ outsideHours: true }))).toBe(
      false,
    );
  });
});

describe('the rule contract', () => {
  const assign = {
    strategy: 'round_robin',
    userIds: ['0b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b11'],
    teamIds: [],
  };

  it('refuses a normal rule with no condition and accepts it as the fallback', () => {
    expect(createRoutingRuleSchema.safeParse({ name: 'All', assign }).success).toBe(false);
    expect(
      createRoutingRuleSchema.safeParse({ name: 'All', assign, isFallback: true }).success,
    ).toBe(true);
  });
  it('needs someone to assign to, and exactly one agent for "specific"', () => {
    const base = { name: 'R', conditions: { keywords: { words: ['x'] } } };
    expect(
      createRoutingRuleSchema.safeParse({ ...base, assign: { strategy: 'round_robin' } }).success,
    ).toBe(false);
    expect(
      createRoutingRuleSchema.safeParse({
        ...base,
        assign: {
          strategy: 'specific',
          userIds: [...assign.userIds, '1b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b11'],
        },
      }).success,
    ).toBe(false);
    expect(createRoutingRuleSchema.safeParse({ ...base, assign }).success).toBe(true);
  });
  it('saves switched off unless asked, and stops on match by default', () => {
    const r = createRoutingRuleSchema.parse({
      name: 'R',
      conditions: { languages: ['ar'] },
      assign,
    });
    expect(r).toMatchObject({
      isActive: false,
      stopOnMatch: true,
      isFallback: false,
      description: '',
    });
  });
  it('knows an empty condition set', () => {
    expect(hasRoutingConditions(cond({}))).toBe(false);
    expect(hasRoutingConditions(cond({ businessHours: 'inside' }))).toBe(true);
  });
});
