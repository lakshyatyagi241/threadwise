import { describe, expect, it } from 'vitest';
import { faqHref, faqTabOf, parseFaqLocation } from './links';

const FLOW = '00000000-0000-4000-8000-0000000000aa';
const FAQ = '11111111-2222-4333-8444-555555555555';

describe('where a flow keeps its FAQs', () => {
  it('links into the FAQs tab of the Simple builder', () => {
    expect(faqHref(FLOW)).toBe(`/flows/simple/${FLOW}?tab=faqs`);
    expect(faqHref(FLOW, 'list')).toBe(`/flows/simple/${FLOW}?tab=faqs`);
    expect(faqHref(FLOW, 'new')).toBe(`/flows/simple/${FLOW}?tab=faqs&view=new`);
    expect(faqHref(FLOW, { faqId: FAQ })).toBe(`/flows/simple/${FLOW}?tab=faqs&view=${FAQ}`);
  });

  it('reads every deep link: list, new, an FAQ id, test, unanswered, insights', () => {
    expect(parseFaqLocation('list')).toEqual({ view: 'list' });
    expect(parseFaqLocation('new')).toEqual({ view: 'new' });
    expect(parseFaqLocation(FAQ)).toEqual({ view: 'edit', id: FAQ });
    for (const v of ['test', 'unanswered', 'insights'] as const)
      expect(parseFaqLocation(v)).toEqual({ view: v });
  });

  it('opens the list for a missing, unknown or malformed view', () => {
    expect(parseFaqLocation(null)).toEqual({ view: 'list' });
    expect(parseFaqLocation('')).toEqual({ view: 'list' });
    expect(parseFaqLocation('nope')).toEqual({ view: 'list' });
    expect(parseFaqLocation('settings')).toEqual({ view: 'list' });
    expect(parseFaqLocation('not-a-uuid-123')).toEqual({ view: 'list' });
  });

  it('puts the list, new and the editor under the FAQs tab of the panel', () => {
    expect(faqTabOf({ view: 'list' })).toBe('faqs');
    expect(faqTabOf({ view: 'new' })).toBe('faqs');
    expect(faqTabOf({ view: 'edit', id: FAQ })).toBe('faqs');
    expect(faqTabOf({ view: 'insights' })).toBe('insights');
  });
});
