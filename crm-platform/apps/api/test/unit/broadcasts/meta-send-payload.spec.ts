import { describe, expect, it } from 'vitest';
import {
  buildSend,
  buttonSubType,
  countPlaceholders,
  normalizeName,
  scalarize,
  type TemplateShape,
} from '../../../src/infra/providers/whatsapp/meta-send-payload';

const tpl = (over: Partial<TemplateShape> = {}): TemplateShape => ({
  templateName: 'Promo October',
  language: 'en_US',
  templateType: 'standard',
  templateBody: 'Hi {{1}}, your code is {{2}}',
  header: null,
  attachmentType: null,
  attachmentFile: null,
  parameterFormat: 'POSITIONAL',
  variableMap: {},
  buttons: [],
  carouselData: [],
  ...over,
});

const comp = (p: ReturnType<typeof buildSend>, type: string) =>
  p.components.filter((c) => (c as { type: string }).type === type);

describe('helpers', () => {
  it('normalizes a template name the way Meta wants it', () => {
    expect(normalizeName('  Promo October!! ')).toBe('promo_october');
    expect(normalizeName('***')).toBe('untitled_template');
  });

  it('counts every placeholder, named or numbered', () => {
    expect(countPlaceholders('Hi {{1}} and {{ name }} and {{1}}')).toBe(3);
    expect(countPlaceholders(null)).toBe(0);
  });

  it('flattens arrays and objects instead of throwing', () => {
    expect(scalarize(['a', 'b', { x: 1 }])).toBe('a, b');
    expect(scalarize({ example: 'Ana', key: 'first_name' })).toBe('Ana');
    expect(scalarize({ num: 1, key: 'first_name' })).toBe('first_name');
    expect(scalarize(null)).toBe('');
    expect(scalarize(7)).toBe('7');
  });

  it('maps button aliases to the sub-type that carries a parameter', () => {
    expect(buttonSubType('visit_website')).toBe('url');
    expect(buttonSubType('copy_text')).toBe('copy_code');
    expect(buttonSubType('QUICK_REPLY')).toBe('quick_reply');
    for (const t of ['call', 'phone_number', 'voice_call', 'catalog'])
      expect(buttonSubType(t)).toBeNull();
  });
});

describe('body (WD-BCAST-017: exactly the declared parameter count)', () => {
  it('fills the body in order', () => {
    const p = buildSend(tpl(), { body: ['Ana', 'X1'] });
    expect(p.name).toBe('promo_october');
    expect(p.language).toEqual({ code: 'en_US' });
    expect(comp(p, 'body')[0]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Ana' },
        { type: 'text', text: 'X1' },
      ],
    });
  });

  it('pads a short list and cuts a long one to the placeholder count', () => {
    const count = (body: string[]) =>
      (comp(buildSend(tpl(), { body }), 'body')[0] as { parameters: unknown[] }).parameters.length;
    expect(count(['Ana'])).toBe(2);
    expect(count(['a', 'b', 'c', 'd'])).toBe(2);
  });

  it('has no body component when the template has no placeholder, even with stray values', () => {
    expect(
      comp(buildSend(tpl({ templateBody: 'Hello there' }), { body: ['stray'] }), 'body'),
    ).toEqual([]);
  });

  it('never sends an empty parameter: example, then the placeholder name, then a dash', () => {
    const t = tpl({
      templateBody: 'Hi {{name}} {{city}} {{3}}',
      variableMap: { body: [{ num: 1, key: 'name', example: 'Friend' }] },
    });
    const params = (
      comp(buildSend(t, { body: ['', '  ', ''] }), 'body')[0] as {
        parameters: Array<{ text: string }>;
      }
    ).parameters;
    expect(params.map((x) => x.text)).toEqual(['Friend', 'city', '-']);
  });

  it('tags NAMED parameters with their name and sends a repeated name once', () => {
    const t = tpl({ templateBody: 'Hi {{name}}, bye {{name}}', parameterFormat: 'NAMED' });
    const params = (
      comp(buildSend(t, { body: ['Ana', 'Ana'] }), 'body')[0] as { parameters: unknown[] }
    ).parameters;
    expect(params).toEqual([{ type: 'text', text: 'Ana', parameter_name: 'name' }]);
  });
});

describe('header', () => {
  it('has none for a text header without a placeholder', () => {
    expect(comp(buildSend(tpl({ header: 'Welcome' }), { header: 'stray' }), 'header')).toEqual([]);
  });

  it('carries one parameter for a text header with a placeholder, and never an empty one', () => {
    const t = tpl({ header: 'Hello {{1}}', variableMap: {} });
    expect(comp(buildSend(t, { header: 'Ana' }), 'header')[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'text', text: 'Ana' }],
    });
    const blank = comp(buildSend(t, { header: '' }), 'header')[0] as {
      parameters: Array<{ text: string }>;
    };
    expect(blank.parameters[0]!.text).toBe('-');
  });

  it('builds an image header from the media link (or id, which wins)', () => {
    const t = tpl({ attachmentType: 'IMAGE', templateBody: 'Hi' });
    expect(
      comp(buildSend(t, { headerMediaUrl: 'https://cdn.example.com/a.jpg' }), 'header')[0],
    ).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/a.jpg' } }],
    });
    expect(
      comp(buildSend(t, { headerMediaUrl: 'https://x/a.jpg', headerMediaId: 'M1' }), 'header')[0],
    ).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: 'M1' } }],
    });
    expect(comp(buildSend(t, {}), 'header')).toEqual([]);
  });

  it('gives a document a real filename, never our random upload name', () => {
    const t = tpl({ attachmentType: 'DOCUMENT', templateName: 'Price list', templateBody: 'Hi' });
    type Doc = { parameters: Array<{ document: { filename: string } }> };
    const named = comp(
      buildSend(t, { headerMediaUrl: 'https://cdn.example.com/files/prices-2026.pdf' }),
      'header',
    )[0] as Doc;
    expect(named.parameters[0]!.document.filename).toBe('prices-2026.pdf');
    const random = comp(
      buildSend(t, {
        headerMediaUrl: 'https://cdn.example.com/1696150000_aBcDeFgHiJkLmNoPqRsTu.pdf',
      }),
      'header',
    )[0] as Doc;
    expect(random.parameters[0]!.document.filename).toBe('Price list.pdf');
  });

  it('builds a location header only when it has coordinates', () => {
    const t = tpl({ attachmentType: 'LOCATION', templateBody: 'Hi' });
    expect(
      comp(
        buildSend(t, { headerLocation: { latitude: 19.07, longitude: 72.87, name: 'Shop' } }),
        'header',
      )[0],
    ).toEqual({
      type: 'header',
      parameters: [
        {
          type: 'location',
          location: { latitude: '19.07', longitude: '72.87', name: 'Shop', address: '' },
        },
      ],
    });
    expect(comp(buildSend(t, { headerLocation: { latitude: 19 } }), 'header')).toEqual([]);
  });
});

describe('buttons (WD-BCAST-017: only a button that takes a parameter gets one)', () => {
  const buttons = [
    { type: 'url', value: 'https://shop.example.com/{{1}}' },
    { type: 'url', value: 'https://static.example.com' },
    { type: 'phone_number', value: '+911234567890' },
    { type: 'quick_reply', value: '' },
    { type: 'copy_code', value: 'SAVE10' },
  ];
  const t = tpl({ templateBody: 'Hi', buttons });

  it('emits a parameter for a URL with a placeholder, a quick reply and a copy-code button', () => {
    const p = buildSend(t, {
      buttons: [
        { index: 0, subType: 'url', value: 'https://shop.example.com/abc' },
        { index: 3, subType: 'quick_reply', value: 'YES' },
        { index: 4, subType: 'copy_code', value: 'SAVE10' },
      ],
    });
    expect(comp(p, 'button')).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: 'https://shop.example.com/abc' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: 3,
        parameters: [{ type: 'payload', payload: 'YES' }],
      },
      {
        type: 'button',
        sub_type: 'copy_code',
        index: 4,
        parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
      },
    ]);
  });

  it('emits nothing for a static URL or a phone button', () => {
    const p = buildSend(t, {
      buttons: [
        { index: 1, subType: 'url', value: 'https://static.example.com' },
        { index: 2, subType: 'phone_number', value: '+91' },
      ],
    });
    expect(comp(p, 'button')).toEqual([]);
  });
});

describe('carousel and catalog', () => {
  it('builds one card per entry, re-indexed from zero, with its media, body and buttons', () => {
    const t = tpl({
      templateType: 'carousel',
      templateBody: 'Look',
      carouselData: [
        { buttons: [{ type: 'url', value: 'https://s.example.com/{{1}}' }] },
        { buttons: [] },
      ],
    });
    const p = buildSend(t, {
      cards: [
        {
          headerMediaUrl: 'https://cdn.example.com/c1.jpg',
          headerFormat: 'image',
          body: ['One'],
          buttons: [{ index: 0, subType: 'url', value: 'https://s.example.com/p1' }],
        },
        { headerMediaUrl: 'https://cdn.example.com/c2.mp4', headerFormat: 'video' },
      ],
    });
    const carousel = comp(p, 'carousel')[0] as {
      cards: Array<{ card_index: number; components: Array<{ type: string }> }>;
    };
    expect(carousel.cards.map((c) => c.card_index)).toEqual([0, 1]);
    expect(carousel.cards[0]!.components.map((c) => c.type)).toEqual(['header', 'body', 'button']);
    expect(carousel.cards[1]!.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'video', video: { link: 'https://cdn.example.com/c2.mp4' } }],
    });
  });

  it('builds the catalog button from the retailer id on the template', () => {
    const t = tpl({
      templateType: 'catalog',
      templateBody: 'Shop',
      buttons: [{ type: 'catalog', value: 'SKU-9' }],
    });
    expect(comp(buildSend(t, {}), 'button')[0]).toEqual({
      type: 'button',
      sub_type: 'catalog',
      index: 0,
      parameters: [{ type: 'action', action: { thumbnail_product_retailer_id: 'SKU-9' } }],
    });
  });
});
