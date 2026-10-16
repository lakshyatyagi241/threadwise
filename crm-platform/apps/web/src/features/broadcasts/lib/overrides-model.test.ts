import { describe, expect, it } from 'vitest';
import type { ComposeTemplate } from '@crm/contracts';
import {
  buildMeta,
  buttonKind,
  chipKeys,
  emptyState,
  hasFields,
  normalizeKey,
  toOverrides,
} from './overrides-model';

const tpl = (o: Partial<ComposeTemplate> = {}): ComposeTemplate => ({
  id: 't',
  name: 'promo',
  header: 'Sale for {{name}}',
  body: 'Hi {{1}}, your {{Phone Number}} order {{2}}',
  footer: 'Reply {{city}}',
  category: 'marketing',
  type: 'standard',
  engine: 'waba',
  language: 'en_US',
  buttons: [
    { type: 'url', text: 'Shop', value: 'https://x.test/{{1}}' },
    { type: 'quick_reply', text: 'Yes' },
    { type: 'phone_number', text: 'Call', value: '+1' },
    { type: 'copy_code', text: 'Copy', value: '{{1}}' },
  ],
  variableMap: {
    header: [{ num: 1, key: 'name' }],
    body: [
      { num: 1, key: 'first_name' },
      { num: 2, key: 'order_id' },
    ],
  },
  attachmentType: null,
  attachmentUrl: null,
  senderLabel: null,
  twilioReady: false,
  ...o,
});

describe('keys', () => {
  it('normalises names and aliases the way the server does', () => {
    expect(normalizeKey('Phone Number')).toBe('phone');
    expect(normalizeKey(' E-Mail ')).toBe('email');
    expect(normalizeKey('Order.ID')).toBe('order_id');
    expect(normalizeKey('Customer Name')).toBe('name');
  });
  it('button kinds: the aliases collapse; a phone button and an unknown type behave', () => {
    expect(
      [
        'visit_website',
        'URL',
        'cta_url',
        'copy_text',
        'coupon_code',
        'call',
        'catalog',
        'whatever',
      ].map(buttonKind),
    ).toEqual(['url', 'url', 'url', 'copy_code', 'copy_code', 'phone', 'phone', 'quick_reply']);
  });
});

// The same table as the API's `template-vocab.spec.ts` (kinds fold to what a button takes at send time); change both together.
// 'phone' here means "static": it takes no value (a phone, voice call, catalog, flow, OTP or product-list button).
const FOLD: Array<[string, ReturnType<typeof buttonKind>]> = [
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
  ['VOICE_CALL', 'phone'],
  ['CATALOG', 'phone'],
  ['FLOW', 'phone'],
  ['OTP', 'phone'],
  ['otp_one_tap', 'phone'],
  ['MPM', 'phone'],
  ['SPM', 'phone'],
  ['something_new', 'quick_reply'],
  ['', 'quick_reply'],
];

describe('button kinds, in every spelling (the same table as the API)', () => {
  it.each(FOLD)('%s is %s', (type, kind) => {
    expect(buttonKind(type)).toBe(kind);
  });

  it('a button of our own template form shows its example as the value a blank override sends', () => {
    const m = buildMeta(
      tpl({
        buttons: [
          { type: 'URL', text: 'Track', url: 'https://shop.test/{{1}}', example: ['ORD-1'] },
          { type: 'visit_website', text: 'Site', value: 'https://shop.test/{{name}}' },
          { type: 'FLOW', text: 'Start', flow_id: '1' },
        ],
      }),
    );
    expect(m.buttons.map((b) => [b.kind, b.editable, b.value])).toEqual([
      ['url', true, 'ORD-1'],
      ['url', true, 'https://shop.test/{{name}}'],
      ['phone', false, ''],
    ]);
  });
});

describe('panel meta', () => {
  const m = buildMeta(tpl());
  it('counts slots per section and labels a positional slot with its mapped attribute', () => {
    expect([m.header.slots, m.body.slots, m.footer.slots]).toEqual([1, 3, 1]);
    expect(m.body.tokens).toEqual([
      { name: 'First name', key: 'first_name' },
      { name: 'Phone Number', key: 'phone' },
      { name: 'Order id', key: 'order_id' },
    ]);
    expect(m.header.tokens[0]).toEqual({ name: 'name', key: 'name' });
    expect(m.body.defaults).toEqual(['{{first_name}}', '{{order_id}}']);
  });
  it('only URL and copy-code buttons take a value', () => {
    expect(m.buttons.map((b) => [b.kind, b.editable])).toEqual([
      ['url', true],
      ['quick_reply', false],
      ['phone', false],
      ['copy_code', true],
    ]);
  });
  it('locks: auth edits nothing; Twilio edits variables but not media or buttons; a media header is editable on Meta', () => {
    expect(buildMeta(tpl({ type: 'auth' }))).toMatchObject({
      editable: false,
      lockedReason: 'auth',
    });
    expect(buildMeta(tpl({ engine: 'twilio', attachmentType: 'IMAGE' }))).toMatchObject({
      editable: true,
      lockedReason: 'twilio',
      mediaEditable: false,
      buttonsEditable: false,
    });
    const media = buildMeta(
      tpl({ attachmentType: 'image', header: null, attachmentUrl: 'https://x.test/a.png' }),
    );
    expect(media).toMatchObject({
      mediaEditable: true,
      headerFormat: 'IMAGE',
      headerMediaUrl: 'https://x.test/a.png',
    });
    expect(media.header.slots).toBe(0);
  });
  it('a template with nothing to fill in says so; a flat variable map works', () => {
    expect(
      hasFields(
        buildMeta(tpl({ header: null, body: 'Hello', footer: null, buttons: [], variableMap: {} })),
      ),
    ).toBe(false);
    const flat = buildMeta(tpl({ body: 'Hi {{1}}', variableMap: { '1': 'first_name' } }));
    expect(flat.body.tokens[0]).toEqual({ name: 'First name', key: 'first_name' });
  });
});

describe('the overrides posted', () => {
  const m = buildMeta(tpl());
  it('nothing typed is no override', () => {
    expect(toOverrides(emptyState(m), m)).toBeNull();
  });
  it('typed slots, a header text and button values; blank buttons and sections are left out', () => {
    const s = {
      ...emptyState(m),
      header: 'Big sale',
      body: ['', '', '{{city}}'],
      buttons: { 0: ' https://y.test ', 3: '', 1: 'x' },
    };
    expect(toOverrides(s, m)).toEqual({
      header: { mode: 'text', text: 'Big sale' },
      body: ['', '', '{{city}}'],
      buttons: [{ index: 0, subType: 'url', value: 'https://y.test' }],
    });
  });
  it('a pasted media link wins over header text', () => {
    const s = { ...emptyState(m), header: 'ignored', mediaUrl: ' https://x.test/a.png ' };
    expect(toOverrides(s, m)).toEqual({
      header: { mode: 'media', mediaUrl: 'https://x.test/a.png' },
    });
  });
});

describe('chips', () => {
  it('the slot own attribute first, then the usual ones, five at most, only those the workspace has', () => {
    expect(
      chipKeys(
        ['city', 'email', 'first_name', 'order_id', 'phone', 'name', 'company_name'],
        'order_id',
      ),
    ).toEqual(['order_id', 'first_name', 'name', 'phone', 'email']);
    expect(chipKeys(['x'], null)).toEqual([]);
  });
});
