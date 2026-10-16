import { describe, expect, it } from 'vitest';
import { messengerButtons } from '../../../src/modules/channel-facebook/broadcast-rules';
import { templateButtonsMarkup } from '../../../src/modules/channel-telegram/telegram-markup';
import { sanitizeOverrides } from '../../../src/modules/broadcasts/payload/template-overrides';
import { buildRecipientVars } from '../../../src/modules/broadcasts/payload/template-vars';
import { templateSlots } from '../../../src/modules/campaigns/wizard/wizard-rules';
import { buttonTypeOf } from '../../../src/modules/team-inbox-conversations/inbox-template-rules';
import { buildSend, buttonSubType } from '../../../src/infra/providers/whatsapp/meta-send-payload';
import {
  buttonAddress,
  buttonExample,
  buttonKindOf,
  buttonPhone,
  headerFormatOf,
  isMediaHeader,
  kindOfButton,
  sendKindOf,
} from '../../../src/infra/providers/whatsapp/template-vocab';

/**
 * A template's buttons and header arrive in three spellings (Meta's, our own form's, Reference's) and every consumer has to read all of
 * them the same way. The table below is also held in `apps/web/src/features/broadcasts/lib/overrides-model.test.ts`; change both together.
 */
const BUTTON_TABLE: Array<[string, ReturnType<typeof buttonKindOf>]> = [
  ['URL', 'url'],
  ['url', 'url'],
  ['visit_website', 'url'],
  ['VISIT_WEBSITE', 'url'],
  ['cta_url', 'url'],
  ['quick_reply_url', 'url'],
  ['QUICK_REPLY', 'quick_reply'],
  ['quick_reply', 'quick_reply'],
  ['PHONE_NUMBER', 'phone'],
  ['call_phone', 'phone'],
  ['call', 'phone'],
  ['phone', 'phone'],
  ['cta_call', 'phone'],
  ['COPY_CODE', 'copy_code'],
  ['copy_text', 'copy_code'],
  ['coupon_code', 'copy_code'],
  ['VOICE_CALL', 'voice_call'],
  ['CATALOG', 'catalog'],
  ['FLOW', 'flow'],
  ['OTP', 'otp'],
  ['otp_one_tap', 'otp'],
  ['MPM', 'mpm'],
  ['SPM', 'spm'],
  ['something_new', 'other'],
  ['', 'other'],
];

describe('the kind of a button, in every spelling', () => {
  it.each(BUTTON_TABLE)('%s is %s', (type, kind) => {
    expect(buttonKindOf(type)).toBe(kind);
    expect(kindOfButton({ type })).toBe(kind);
  });

  it("reads Meta's `sub_type` when there is no `type`, and nothing from a non-button", () => {
    expect(kindOfButton({ sub_type: 'url' })).toBe('url');
    expect(kindOfButton(null)).toBe('other');
    expect(kindOfButton('URL')).toBe('other');
  });

  it('what each kind takes at send time: a link, a code or a payload; the static kinds nothing', () => {
    expect(sendKindOf('url')).toBe('url');
    expect(sendKindOf('copy_code')).toBe('copy_code');
    expect(sendKindOf('quick_reply')).toBe('quick_reply');
    expect(sendKindOf('other')).toBe('quick_reply');
    for (const k of ['phone', 'voice_call', 'catalog', 'flow', 'otp', 'mpm', 'spm'] as const) {
      expect(sendKindOf(k), k).toBeNull();
    }
    expect(buttonSubType('FLOW')).toBeNull();
    expect(buttonSubType('OTP')).toBeNull();
    expect(buttonSubType('URL')).toBe('url');
  });

  it('finds the link, the number and the sample wherever the spelling keeps them', () => {
    expect(buttonAddress({ type: 'URL', url: 'https://a.test/{{1}}' })).toBe(
      'https://a.test/{{1}}',
    );
    expect(buttonAddress({ type: 'visit_website', value: 'https://b.test/{{name}}' })).toBe(
      'https://b.test/{{name}}',
    );
    expect(buttonPhone({ type: 'PHONE_NUMBER', phone_number: '+1555' })).toBe('+1555');
    expect(buttonPhone({ type: 'call_phone', value: '+1666' })).toBe('+1666');
    expect(buttonExample({ example: ['abc'] })).toBe('abc');
    expect(buttonExample({ example: 'xyz' })).toBe('xyz');
    expect(buttonExample({})).toBe('');
  });
});

describe('the header, in every spelling', () => {
  it.each([
    ['image', 'image'],
    ['IMAGE', 'image'],
    ['Video', 'video'],
    ['DOCUMENT', 'document'],
    ['location', 'location'],
    ['TEXT', 'text'],
    ['none', 'none'],
    ['', 'none'],
    [null, 'none'],
    ['gif', 'none'],
  ])('%s is %s', (raw, format) => {
    expect(headerFormatOf(raw)).toBe(format);
  });
  it('a file header is an image, a video or a document', () => {
    expect(isMediaHeader('IMAGE')).toBe(true);
    expect(isMediaHeader('location')).toBe(false);
    expect(isMediaHeader(null)).toBe(false);
  });
});

const tpl = (buttons: unknown[], extra: Record<string, unknown> = {}) => ({
  templateName: 't',
  language: 'en_US',
  templateType: 'standard',
  templateBody: 'Hi {{1}}',
  header: null,
  attachmentType: null,
  attachmentFile: null,
  parameterFormat: 'POSITIONAL',
  variableMap: { body: [{ num: 1, key: 'first_name', example: 'Asha' }] },
  buttons,
  carouselData: null,
  ...extra,
});
const ctx = { pull: (k: string) => (k === 'first_name' ? 'Asha' : `<${k}>`), mediaUrl: () => null };
const sent = (buttons: unknown[]) => {
  const t = tpl(buttons);
  return buildSend(t, buildRecipientVars(t, ctx)).components.filter(
    (c) => (c as { type: string }).type === 'button',
  ) as Array<{ sub_type: string; index: number; parameters: Array<Record<string, string>> }>;
};

describe('the send path reads every spelling of a button the same way', () => {
  it("a link of our own form (Meta's `url` and `example`) goes out with its example, never an empty parameter", () => {
    const [c] = sent([
      { type: 'URL', text: 'Shop', url: 'https://shop.test/{{1}}', example: ['abc'] },
    ]);
    expect(c).toMatchObject({
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: 'abc' }],
    });
  });

  it('a link with no example falls back to "-" rather than an empty parameter (#131008)', () => {
    const [c] = sent([{ type: 'URL', text: 'Shop', url: 'https://shop.test/{{1}}' }]);
    expect(c?.parameters[0]?.text).toBe('-');
  });

  it('a link whose placeholder is a field name resolves to that field, as only the changing part', () => {
    const [c] = sent([{ type: 'URL', text: 'Shop', url: 'https://shop.test/{{first_name}}' }]);
    expect(c?.parameters[0]?.text).toBe('Asha');
  });

  it("Reference's link (`visit_website` with `value`) goes out resolved, as before", () => {
    const [c] = sent([
      { type: 'visit_website', text: 'Shop', value: 'https://shop.test/{{first_name}}' },
    ]);
    expect(c?.parameters[0]?.text).toBe('https://shop.test/Asha');
  });

  it('a fixed link carries no parameter, in either spelling', () => {
    expect(sent([{ type: 'URL', text: 'Site', url: 'https://shop.test' }])).toEqual([]);
    expect(sent([{ type: 'visit_website', text: 'Site', value: 'https://shop.test' }])).toEqual([]);
  });

  it('the static kinds carry no parameter: phone, flow, OTP, product list', () => {
    expect(
      sent([
        { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+1555' },
        { type: 'FLOW', text: 'Go', flow_id: '1', value: 'x' },
        { type: 'OTP', otp_type: 'COPY_CODE', value: 'x' },
        { type: 'MPM', text: 'List', value: 'x' },
      ]),
    ).toEqual([]);
  });

  it('a copy-code button of our form with no value goes out with its example', () => {
    const [c] = sent([{ type: 'COPY_CODE', text: 'Copy', example: 'SAVE20' }]);
    expect(c).toMatchObject({
      sub_type: 'copy_code',
      parameters: [{ type: 'coupon_code', coupon_code: 'SAVE20' }],
    });
  });

  it('a quick reply with no payload carries none; with one it goes out', () => {
    expect(sent([{ type: 'QUICK_REPLY', text: 'Yes' }])).toEqual([]);
    const [c] = sent([{ type: 'quick_reply', text: 'Yes', value: 'yes_1' }]);
    expect(c?.parameters).toEqual([{ type: 'payload', payload: 'yes_1' }]);
  });

  it('a header in any case sends its file', () => {
    for (const attachmentType of ['image', 'IMAGE', 'Image']) {
      const t = tpl([], { attachmentType, attachmentFile: 'a.jpg' });
      const send = buildSend(t, {
        ...buildRecipientVars(t, { ...ctx, mediaUrl: () => 'https://cdn.test/a.jpg' }),
      });
      expect(JSON.stringify(send.components), attachmentType).toContain('"type":"image"');
    }
  });
});

describe('the overrides take any spelling of a button kind', () => {
  it('URL, visit_website and cta_url are a link; copy_text a code; QUICK_REPLY a payload; anything else is a link', () => {
    const o = sanitizeOverrides({
      buttons: [
        { index: 0, subType: 'URL', value: 'a' },
        { index: 1, subType: 'visit_website', value: 'b' },
        { index: 2, subType: 'copy_text', value: 'c' },
        { index: 3, subType: 'QUICK_REPLY', value: 'd' },
        { index: 4, subType: 'who_knows', value: 'e' },
      ],
    });
    expect(o?.buttons?.map((b) => b.subType)).toEqual([
      'url',
      'url',
      'copy_code',
      'quick_reply',
      'url',
    ]);
  });
});

describe('the other consumers read every spelling too', () => {
  it('the inbox bubble draws a Meta, a form and a Reference button alike', () => {
    expect(['URL', 'url', 'visit_website'].map(buttonTypeOf)).toEqual(['url', 'url', 'url']);
    expect(['PHONE_NUMBER', 'call_phone'].map(buttonTypeOf)).toEqual(['phone', 'phone']);
    expect(['COPY_CODE', 'OTP', 'copy_text'].map(buttonTypeOf)).toEqual([
      'copy_code',
      'copy_code',
      'copy_code',
    ]);
    expect(['QUICK_REPLY', 'quick_reply'].map(buttonTypeOf)).toEqual([
      'quick_reply',
      'quick_reply',
    ]);
    expect(buttonTypeOf('FLOW')).toBe('other');
  });

  it('a Messenger broadcast turns a Meta link and a Reference link into a link, and a phone into a call', () => {
    const out = messengerButtons([
      { type: 'URL', text: 'Shop', url: 'https://a.test' },
      { type: 'visit_website', text: 'Site', value: 'https://b.test' },
      { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+1555' },
    ]);
    expect(out).toEqual([
      { type: 'web_url', title: 'Shop', url: 'https://a.test' },
      { type: 'web_url', title: 'Site', url: 'https://b.test' },
      { type: 'phone_number', title: 'Call', payload: '+1555' },
    ]);
    expect(messengerButtons([{ type: 'QUICK_REPLY', text: 'Yes' }])[0]?.type).toBe('postback');
  });

  it('a Telegram broadcast does the same', () => {
    const m = templateButtonsMarkup([
      { type: 'URL', text: 'Shop', url: 'https://a.test' },
      { type: 'visit_website', text: 'Site', value: 'https://b.test' },
      { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+1555' },
    ]);
    expect(JSON.stringify(m.replyMarkup)).toContain('https://a.test');
    expect(JSON.stringify(m.replyMarkup)).toContain('https://b.test');
    expect(m.append).toContain('Call: +1555');
  });

  it("the wizard asks for a link button's value in either spelling", () => {
    const slots = (buttons: unknown[]) =>
      templateSlots({ templateBody: 'Hi', header: null, variableMap: {}, buttons }).filter(
        (s) => s.section === 'button',
      );
    expect(
      slots([{ type: 'URL', url: 'https://a.test/{{1}}', example: ['x'] }]).map((s) => [
        s.slot,
        s.example,
      ]),
    ).toEqual([['button.0', 'x']]);
    expect(
      slots([{ type: 'visit_website', value: 'https://a.test/{{name}}' }]).map((s) => s.slot),
    ).toEqual(['button.0']);
    expect(slots([{ type: 'URL', url: 'https://a.test' }])).toEqual([]);
    expect(slots([{ type: 'PHONE_NUMBER', phone_number: '+1' }])).toEqual([]);
  });
});
