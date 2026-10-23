import { describe, expect, it } from 'vitest';
import { lintTemplate } from '../../../src/modules/message-templates/template-linter';
import { prepareTemplate } from '../../../src/modules/message-templates/template-input';
import { buildMetaTemplate } from '../../../src/modules/message-templates/template-payload';
import {
  mergeCards,
  parseRemoteComponents,
} from '../../../src/modules/message-templates/template-remote';
import { cardsViewOf } from '../../../src/modules/message-templates/templates.mapper';

const card = (over: Record<string, unknown> = {}) => ({
  format: 'image',
  image: 'template-media/1/a.png',
  headerHandle: '4::aW1h',
  headerSampleUrl: 'https://scontent.example/a.png',
  body: 'Summer sale',
  buttons: [{ type: 'URL', text: 'Shop', url: 'https://example.com/shop' }],
  ...over,
});
const draft = (cards: unknown[]) => ({
  name: 'Summer Cards',
  language: 'en_US',
  metaCategory: 'MARKETING',
  templateType: 'carousel',
  body: 'Our picks for you',
  cards: cards as never,
});
const codes = (i: ReturnType<typeof lintTemplate>) => i.map((x) => x.code);

describe('carousel templates', () => {
  it("builds Meta's CAROUSEL component: the bubble text, then each card as a picture, a text and its buttons", () => {
    const out = buildMetaTemplate({
      ...draft([card(), card({ body: 'Winter sale' })]),
      attachmentType: 'none',
    } as never);
    expect(out.components).toEqual([
      { type: 'BODY', text: 'Our picks for you' },
      {
        type: 'CAROUSEL',
        cards: [
          {
            components: [
              { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aW1h'] } },
              { type: 'BODY', text: 'Summer sale' },
              {
                type: 'BUTTONS',
                buttons: [{ type: 'URL', text: 'Shop', url: 'https://example.com/shop' }],
              },
            ],
          },
          {
            components: [
              { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aW1h'] } },
              { type: 'BODY', text: 'Winter sale' },
              {
                type: 'BUTTONS',
                buttons: [{ type: 'URL', text: 'Shop', url: 'https://example.com/shop' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('has no header, footer or buttons of its own once prepared', () => {
    const p = prepareTemplate({
      ...draft([card(), card()]),
      header: 'Nope',
      footer: 'Nope',
      attachmentType: 'image',
      buttons: [{ type: 'QUICK_REPLY', text: 'x' }],
      parameterFormat: 'POSITIONAL',
    } as never);
    expect(p).toMatchObject({
      templateType: 'carousel',
      header: null,
      footer: null,
      buttons: [],
      attachmentType: null,
    });
    expect(p.cards).toHaveLength(2);
  });

  it("lints Meta's carousel rules", () => {
    const lint = (cards: unknown[]) =>
      codes(lintTemplate({ ...draft(cards), templateType: 'carousel' } as never));
    expect(lint([card(), card()])).not.toContain('cards_few');
    expect(lint([card()])).toContain('cards_few');
    expect(lint(Array.from({ length: 11 }, () => card()))).toContain('cards_many');
    expect(lint([card(), card({ format: 'video' })])).toContain('cards_format');
    expect(lint([card(), card({ buttons: [] })])).toEqual(
      expect.arrayContaining(['cards_buttons', 'card_buttons_none']),
    );
    expect(lint([card(), card({ headerHandle: null, headerSampleUrl: null })])).toContain(
      'card_file',
    );
    expect(lint([card(), card({ body: '' })])).toContain('card_body');
    expect(lint([card(), card({ body: 'x'.repeat(161) })])).toContain('card_body_long');
    expect(lint([card(), card({ body: 'Hi {{1}}' })])).toContain('card_variable');
    expect(lint([card(), card({ buttons: [{ type: 'COPY_CODE', text: 'c' }] })])).toContain(
      'card_button_type',
    );
  });

  it('is read back from Meta: the cards keep their text and buttons, and a sync keeps our uploaded files', () => {
    const remote = parseRemoteComponents(
      [
        { type: 'BODY', text: 'Our picks for you' },
        {
          type: 'CAROUSEL',
          cards: [
            {
              components: [
                {
                  type: 'HEADER',
                  format: 'IMAGE',
                  example: { header_handle: ['https://cdn.meta/1.png'] },
                },
                { type: 'BODY', text: 'Summer sale' },
                { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'More' }] },
              ],
            },
          ],
        },
      ],
      'MARKETING',
    );
    expect(remote.templateType).toBe('carousel');
    expect(remote.cards).toEqual([
      {
        format: 'image',
        image: 'https://cdn.meta/1.png',
        headerHandle: null,
        headerSampleUrl: 'https://cdn.meta/1.png',
        body: 'Summer sale',
        buttons: [{ type: 'QUICK_REPLY', text: 'More' }],
      },
    ]);
    const kept = mergeCards(remote.cards, [
      card({ body: 'Summer sale', image: 'template-media/1/mine.png' }),
    ]);
    expect(kept[0]).toMatchObject({ image: 'template-media/1/mine.png', headerHandle: '4::aW1h' });
    // A card whose text changed on Meta is not matched to the old file.
    expect(mergeCards(remote.cards, [card({ body: 'Other' })])[0]!.image).toBe(
      'https://cdn.meta/1.png',
    );
  });

  it("shows a card with a link to its file: a fresh link for ours, Meta's sample otherwise", () => {
    const row = { carouselData: [card(), card({ image: null })] };
    const links = new Map([['template-media/1/a.png', 'https://files.example/a?sig=1']]);
    expect(cardsViewOf(row, links).map((c) => c.imageUrl)).toEqual([
      'https://files.example/a?sig=1',
      'https://scontent.example/a.png',
    ]);
    expect(cardsViewOf(row).map((c) => c.imageUrl)).toEqual([
      'https://scontent.example/a.png',
      'https://scontent.example/a.png',
    ]);
  });
});

describe('form and catalog buttons', () => {
  const lint = (buttons: Array<Record<string, unknown>>) =>
    lintTemplate({
      name: 'promo',
      language: 'en_US',
      metaCategory: 'MARKETING',
      templateType: 'standard',
      body: 'Hello',
      buttons,
    } as Parameters<typeof lintTemplate>[0]).map((i) => i.code);

  it('a form button needs a numeric Flow id and a screen', () => {
    expect(lint([{ type: 'FLOW', text: 'Book' }])).toEqual(
      expect.arrayContaining(['flow_id', 'flow_screen']),
    );
    expect(
      lint([
        {
          type: 'FLOW',
          text: 'Book',
          flow_id: '123',
          flow_action: 'navigate',
          navigate_screen: 'A',
        },
      ]),
    ).not.toEqual(expect.arrayContaining(['flow_id', 'flow_screen']));
  });

  it('a catalog button cannot sit with other buttons, and is sent as CATALOG', () => {
    expect(
      lint([
        { type: 'CATALOG', text: 'View catalog' },
        { type: 'QUICK_REPLY', text: 'Hi' },
      ]),
    ).toContain('catalog_alone');
    const body = buildMetaTemplate({
      name: 'shop',
      templateType: 'standard',
      body: 'Hello',
      buttons: [{ type: 'CATALOG', text: 'View catalog' }],
    });
    expect(body.components.at(-1)).toEqual({
      type: 'BUTTONS',
      buttons: [{ type: 'CATALOG', text: 'View catalog' }],
    });
  });
});

describe('limited-time offer templates', () => {
  const offer = {
    name: 'Summer Offer',
    language: 'en_US',
    metaCategory: 'MARKETING',
    templateType: 'lto',
    header: null,
    attachmentType: 'image',
    headerHandle: '4::aW1h',
    body: 'Hi {{1}}, our sale ends soon',
    footer: 'ignored',
    buttons: [
      { type: 'COPY_CODE', example: 'SAVE20' },
      { type: 'URL', text: 'Shop', url: 'https://example.com' },
    ],
    limitedOffer: { text: 'Expiring offer!', hasExpiration: true },
    variableMap: { body: [{ num: 1, key: 'name', example: 'Anya' }] },
    parameterFormat: 'POSITIONAL' as const,
  };

  it('is sent as header, LIMITED_TIME_OFFER, body and buttons (no footer)', () => {
    const prepared = prepareTemplate({ ...offer, attachmentType: 'image' } as never);
    const types = buildMetaTemplate({
      ...offer,
      limitedOffer: prepared.limitedOffer,
    } as never).components.map((c) => c.type);
    expect(types).toEqual(['HEADER', 'LIMITED_TIME_OFFER', 'BODY', 'BUTTONS']);
    expect(prepared.footer).toBeNull();
  });

  it('is linted: Marketing, a heading of 16 characters, a picture header, a copy-code or website button', () => {
    const ok = lintTemplate({ ...offer, hasHeaderFile: true } as never);
    expect(ok.filter((i) => i.severity === 'error')).toEqual([]);
    const bad = lintTemplate({
      ...offer,
      metaCategory: 'UTILITY',
      limitedOffer: { text: 'This heading is much too long', hasExpiration: true },
      attachmentType: 'document',
      buttons: [{ type: 'QUICK_REPLY', text: 'Hi' }],
      hasHeaderFile: true,
    } as never).map((i) => i.code);
    expect(bad).toEqual(
      expect.arrayContaining([
        'lto_category',
        'lto_text_long',
        'lto_header',
        'lto_buttons',
        'lto_button_type',
      ]),
    );
  });
});
