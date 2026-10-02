import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  sanitizeOverrides,
} from '../../../src/modules/broadcasts/payload/template-overrides';
import {
  buildRecipientVars,
  flattenMap,
  type VarsContext,
} from '../../../src/modules/broadcasts/payload/template-vars';
import type { TemplateShape } from '../../../src/infra/providers/whatsapp/meta-send-payload';

const tpl = (over: Partial<TemplateShape> = {}): TemplateShape => ({
  templateName: 'promo',
  language: 'en_US',
  templateType: 'standard',
  templateBody: 'Hi {{1}}, from {{2}}',
  header: null,
  attachmentType: null,
  attachmentFile: null,
  parameterFormat: 'POSITIONAL',
  variableMap: {
    body: [
      { num: 1, key: 'first_name' },
      { num: 2, key: 'company_name' },
    ],
  },
  buttons: [],
  carouselData: [],
  ...over,
});

const values: Record<string, string> = {
  first_name: 'Ana',
  company_name: 'Acme',
  city: 'Pune',
  email: 'ana@x.test',
};
const ctx: VarsContext = {
  pull: (k) => values[k] ?? '',
  mediaUrl: (p) => `https://cdn.example.com/${p}`,
};
const render = (text: string) =>
  text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, k: string) => values[k.trim()] ?? '');

describe('flattenMap', () => {
  it('reads the nested template shape, trusting num when present', () => {
    expect(
      flattenMap({ header: [{ num: 1, key: 'a' }], body: [{ num: 5, key: 'b' }, 'c'] }),
    ).toEqual({ '1': 'a', '5': 'b', '2': 'c' });
  });
  it('reads the flat composer shape', () => {
    expect(flattenMap({ '1': 'first_name', '2': 'email' })).toEqual({
      '1': 'first_name',
      '2': 'email',
    });
  });
  it('is empty for nothing', () => {
    expect(flattenMap(null)).toEqual({});
    expect(flattenMap({})).toEqual({});
  });
});

describe('buildRecipientVars (TW-BCAST-017)', () => {
  it('maps body slots through the variable map for this recipient', () => {
    expect(buildRecipientVars(tpl(), ctx).body).toEqual(['Ana', 'Acme']);
  });

  it('takes the first header slot only', () => {
    const t = tpl({
      header: 'Hello {{1}}',
      variableMap: {
        header: [
          { num: 1, key: 'first_name' },
          { num: 2, key: 'city' },
        ],
        body: [],
      },
    });
    expect(buildRecipientVars(t, ctx).header).toBe('Ana');
  });

  it('passes the stored header media as a link, but not for none or text', () => {
    expect(
      buildRecipientVars(tpl({ attachmentType: 'IMAGE', attachmentFile: 'wa/a.jpg' }), ctx)
        .headerMediaUrl,
    ).toBe('https://cdn.example.com/wa/a.jpg');
    expect(
      buildRecipientVars(tpl({ attachmentType: 'none', attachmentFile: 'wa/a.jpg' }), ctx)
        .headerMediaUrl,
    ).toBeUndefined();
    expect(
      buildRecipientVars(tpl({ attachmentType: 'TEXT', attachmentFile: 'wa/a.jpg' }), ctx)
        .headerMediaUrl,
    ).toBeUndefined();
  });

  it('resolves URL button tokens, translating a positional slot through the variable map', () => {
    const t = tpl({
      buttons: [{ type: 'url', value: 'https://shop.example.com/{{1}}?c={{city}}' }],
    });
    expect(buildRecipientVars(t, ctx).buttons).toEqual([
      { index: 0, subType: 'url', value: 'https://shop.example.com/Ana?c=Pune' },
    ]);
  });

  it('skips phone buttons and an empty quick reply, keeps a filled one', () => {
    const t = tpl({
      buttons: [
        { type: 'phone_number', value: '+91' },
        { type: 'quick_reply', value: '' },
        { type: 'quick_reply', value: 'YES' },
        { type: 'copy_text', value: 'SAVE{{city}}' },
      ],
    });
    expect(buildRecipientVars(t, ctx).buttons).toEqual([
      { index: 2, subType: 'quick_reply', value: 'YES' },
      { index: 3, subType: 'copy_code', value: 'SAVEPune' },
    ]);
  });

  it('never throws on an attribute that is not a string', () => {
    const odd: VarsContext = { pull: () => '', mediaUrl: () => null };
    expect(buildRecipientVars(tpl(), odd).body).toEqual(['', '']);
  });

  it('builds carousel cards with image or video, body variables and buttons', () => {
    const t = tpl({
      templateType: 'carousel',
      variableMap: { cards: [{ body: [{ num: 1, key: 'first_name' }] }, {}] },
      carouselData: [
        {
          image: 'cards/one.jpg',
          buttons: [{ type: 'url', value: 'https://s.example.com/{{1}}' }],
        },
        { image: 'https://cdn.example.com/two.mp4', buttons: [] },
      ],
    });
    const cards = buildRecipientVars(t, ctx).cards!;
    expect(cards[0]).toEqual({
      headerMediaUrl: 'https://cdn.example.com/cards/one.jpg',
      headerFormat: 'image',
      body: ['Ana'],
      buttons: [{ index: 0, subType: 'url', value: 'https://s.example.com/Ana' }],
    });
    expect(cards[1]).toEqual({
      headerMediaUrl: 'https://cdn.example.com/two.mp4',
      headerFormat: 'video',
    });
  });

  it('gives a location template its header from the template', () => {
    const t = {
      ...tpl({ attachmentType: 'LOCATION' }),
      headerLocation: { latitude: 1, longitude: 2 },
    };
    expect(buildRecipientVars(t, ctx).headerLocation).toEqual({ latitude: 1, longitude: 2 });
  });
});

describe('sanitizeOverrides (TW-BCAST-015 rule 3, TW-BCAST-017 rule 9)', () => {
  it('is null when nothing usable is supplied', () => {
    expect(sanitizeOverrides(null)).toBeNull();
    expect(sanitizeOverrides({})).toBeNull();
    expect(
      sanitizeOverrides({
        body: ['', '  '],
        footer: [''],
        header: { mode: 'text', text: ' ' },
        buttons: [{ index: 0, value: '' }],
      }),
    ).toBeNull();
  });

  it('keeps filled slots, trims and cuts them to 1024', () => {
    const out = sanitizeOverrides({
      body: [' VIP ', '', 'x'.repeat(2000)],
      header: { mode: 'text', text: 'h'.repeat(2000) },
    })!;
    expect(out.body).toEqual(['VIP', '', 'x'.repeat(1024)]);
    expect(out.header).toEqual({ mode: 'text', text: 'h'.repeat(1024) });
  });

  it('accepts only an http(s) media url', () => {
    expect(
      sanitizeOverrides({ header: { mode: 'media', mediaUrl: 'https://cdn.example.com/a.png' } })!
        .header,
    ).toEqual({ mode: 'media', mediaUrl: 'https://cdn.example.com/a.png' });
    expect(
      sanitizeOverrides({ header: { mode: 'media', mediaUrl: 'javascript:alert(1)' } }),
    ).toBeNull();
    expect(sanitizeOverrides({ header: { mode: 'media', mediaUrl: 'nope' } })).toBeNull();
  });

  it('buttons need an index and a value; an unknown kind becomes url', () => {
    expect(
      sanitizeOverrides({
        buttons: [
          { index: 1, subType: 'weird', value: ' v ' },
          { value: 'no index' },
          { index: 2, value: '' },
          { index: -1, value: 'x' },
        ],
      })!.buttons,
    ).toEqual([{ index: 1, subType: 'url', value: 'v' }]);
  });
});

describe('applyOverrides (TW-BCAST-017 acceptance)', () => {
  const base = {
    header: 'Ana',
    body: ['Ana', 'Acme'],
    buttons: [{ index: 0, subType: 'url', value: 'https://a.example.com/Ana' }],
  };

  it('is a no-op without overrides', () => {
    expect(applyOverrides(base, null, render).vars).toBe(base);
  });

  it('a filled body slot wins for every recipient; a blank slot keeps the template value', () => {
    const { vars } = applyOverrides(base, { body: ['VIP', ''] }, render);
    expect(vars.body).toEqual(['VIP', 'Acme']);
  });

  it('renders {{tokens}} typed in a slot against the recipient', () => {
    expect(applyOverrides(base, { body: ['Dear {{first_name}}'] }, render).vars.body).toEqual([
      'Dear Ana',
      'Acme',
    ]);
  });

  it('is as long as the longer of the template and the overrides', () => {
    expect(
      applyOverrides({ body: ['a'] }, { body: ['', 'two', 'three'] }, render).vars.body,
    ).toEqual(['a', 'two', 'three']);
  });

  it('swaps the header media and drops a stale media id', () => {
    const { vars } = applyOverrides(
      { headerMediaUrl: 'https://old', headerMediaId: 'M1' },
      { header: { mode: 'media', mediaUrl: 'https://new.example.com/a.png' } },
      render,
    );
    expect(vars.headerMediaUrl).toBe('https://new.example.com/a.png');
    expect(vars.headerMediaId).toBeUndefined();
  });

  it('overrides header text', () => {
    expect(
      applyOverrides(base, { header: { mode: 'text', text: 'Hi {{first_name}}' } }, render).vars
        .header,
    ).toBe('Hi Ana');
  });

  it('matches button overrides by index and reports one the template has no parameter for', () => {
    const { vars, ignoredButtons } = applyOverrides(
      base,
      {
        buttons: [
          { index: 0, subType: 'url', value: 'https://b.example.com/{{city}}' },
          { index: 7, subType: 'url', value: 'https://static' },
        ],
      },
      render,
    );
    expect(vars.buttons).toEqual([
      { index: 0, subType: 'url', value: 'https://b.example.com/Pune' },
    ]);
    expect(ignoredButtons).toEqual([7]);
  });
});
