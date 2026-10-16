import { describe, expect, it } from 'vitest';
import type { TplAiDraft } from '@crm/contracts';
import { applyAiDraft, canDraftCategory, isAiProvider, rowsFromDraft } from './ai-draft';
import { BODY_MAX, FOOTER_MAX, HEADER_MAX, initialState, withHeaderKind } from './form-model';

const draft = (over: Partial<TplAiDraft> = {}): TplAiDraft => ({
  name: 'spring_sale',
  header: 'Spring sale',
  body: 'Hi {{1}}, 20% off this week.',
  footer: 'Reply STOP to opt out',
  buttons: [],
  ...over,
});

describe('rowsFromDraft', () => {
  it('maps the three button types to editor rows', () => {
    const rows = rowsFromDraft([
      { type: 'URL', text: 'Shop', url: 'https://x.test' },
      { type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+15551234567' },
      { type: 'QUICK_REPLY', text: 'Stop' },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['url', 'phone', 'quick_reply']);
    expect(rows[0]).toMatchObject({ text: 'Shop', url: 'https://x.test' });
    expect(rows[1]).toMatchObject({ text: 'Call', phone: '+15551234567' });
    expect(rows[2]).toMatchObject({ text: 'Stop' });
  });

  it('keeps at most three, cuts the text to 25 characters and drops empty ones', () => {
    const rows = rowsFromDraft([
      { type: 'QUICK_REPLY', text: '   ' },
      { type: 'QUICK_REPLY', text: 'a'.repeat(40) },
      { type: 'QUICK_REPLY', text: 'two' },
      { type: 'QUICK_REPLY', text: 'three' },
      { type: 'QUICK_REPLY', text: 'four' },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text).toHaveLength(25);
    expect(rows.map((r) => r.text)).toEqual(['a'.repeat(25), 'two', 'three']);
  });

  it("respects Meta's per-kind limits (two links, one phone)", () => {
    const rows = rowsFromDraft([
      { type: 'PHONE_NUMBER', text: 'One', phoneNumber: '+1555' },
      { type: 'PHONE_NUMBER', text: 'Two', phoneNumber: '+1556' },
      { type: 'URL', text: 'A', url: 'https://a.test' },
      { type: 'URL', text: 'B', url: 'https://b.test' },
    ]);
    expect(rows.map((r) => r.text)).toEqual(['One', 'A', 'B']);
  });
});

describe('applyAiDraft', () => {
  it('fills name, text header, body, footer and buttons and leaves the number, category and language alone', () => {
    const s0 = { ...initialState('conn-1'), language: 'fr', metaCategory: 'MARKETING' as const };
    const s = applyAiDraft(s0, draft({ buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }] }));
    expect(s).toMatchObject({
      connectionId: 'conn-1',
      language: 'fr',
      metaCategory: 'MARKETING',
      name: 'spring_sale',
      headerKind: 'text',
      headerText: 'Spring sale',
      body: 'Hi {{1}}, 20% off this week.',
      footer: 'Reply STOP to opt out',
    });
    expect(s.buttons.map((b) => b.kind)).toEqual(['quick_reply']);
    // The body's {{1}} gets its sample row.
    expect(Object.keys(s.bodySlots)).toContain('1');
  });

  it('slugifies the name and cuts header, body and footer to the form limits', () => {
    const s = applyAiDraft(
      initialState(),
      draft({
        name: 'Spring  Sale!! 2026',
        header: 'h'.repeat(HEADER_MAX + 30),
        body: 'b'.repeat(BODY_MAX + 50),
        footer: 'f'.repeat(FOOTER_MAX + 10),
      }),
    );
    expect(s.name).toBe('spring_sale_2026');
    expect(s.headerText).toHaveLength(HEADER_MAX);
    expect(s.body).toHaveLength(BODY_MAX);
    expect(s.footer).toHaveLength(FOOTER_MAX);
  });

  it('a draft without a header clears a text header but keeps a media header', () => {
    const textHeader = applyAiDraft(initialState(), draft());
    expect(applyAiDraft(textHeader, draft({ header: null })).headerKind).toBe('none');
    const image = withHeaderKind(initialState(), 'image');
    expect(applyAiDraft(image, draft({ header: null })).headerKind).toBe('image');
  });

  it('a draft without footer or buttons empties them', () => {
    const first = applyAiDraft(
      initialState(),
      draft({ buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }] }),
    );
    const s = applyAiDraft(first, draft({ footer: null, buttons: [] }));
    expect(s.footer).toBe('');
    expect(s.buttons).toEqual([]);
  });
});

describe('small helpers', () => {
  it('only Marketing and Utility can be drafted', () => {
    expect(canDraftCategory('MARKETING')).toBe(true);
    expect(canDraftCategory('UTILITY')).toBe(true);
    expect(canDraftCategory('AUTHENTICATION')).toBe(false);
  });
  it('the writer calls openai, anthropic and gemini only', () => {
    expect(['openai', 'anthropic', 'gemini', 'mistral'].map(isAiProvider)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
