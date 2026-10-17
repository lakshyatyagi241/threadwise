import { describe, expect, it } from 'vitest';
import type { ComposeTemplate } from '@crm/contracts';
import {
  contactName,
  fillSamples,
  matchesSearch,
  previewOf,
  slotMap,
  toggle,
} from './compose-model';

describe('preview text', () => {
  it('fills named and positional tokens with samples and leaves unknown ones as written', () => {
    expect(fillSamples('Hi {{name}}, order {{order_id}} {{nope}}', {})).toBe(
      'Hi John, order ORD-12 {{nope}}',
    );
    expect(fillSamples('Hi {{1}} {{2}}', { '1': 'first_name' })).toBe('Hi John {{2}}');
  });
  it('reads both shapes of the variable map', () => {
    expect(slotMap({ header: [{ num: 1, key: 'name' }], body: [{ num: 2, key: 'city' }] })).toEqual(
      { '1': 'name', '2': 'city' },
    );
    expect(slotMap({ '1': 'name' })).toEqual({ '1': 'name' });
    expect(slotMap(null)).toEqual({});
  });
  const tpl = (o: Partial<ComposeTemplate> = {}): ComposeTemplate => ({
    id: 't1',
    name: 'promo',
    header: 'Sale {{1}}',
    body: 'Hi {{1}}',
    footer: 'STOP',
    category: 'marketing',
    type: 'standard',
    engine: 'waba',
    language: 'en_US',
    buttons: [{ type: 'url', text: 'Shop' }, { type: 'url' }],
    variableMap: { body: [{ num: 1, key: 'first_name' }], header: [{ num: 1, key: 'name' }] },
    attachmentType: null,
    attachmentUrl: null,
    senderLabel: 'Main',
    twilioReady: false,
    ...o,
  });
  it('the bubble: header, body, footer, category, buttons with text, and media kind', () => {
    const p = previewOf(tpl({ attachmentType: 'IMAGE' }));
    expect(p).toMatchObject({
      header: 'Sale John',
      body: 'Hi John',
      footer: 'STOP',
      category: 'Marketing',
      media: 'image',
    });
    expect(p.buttons).toHaveLength(1);
    expect(previewOf(tpl({ attachmentType: 'none', body: '' })).media).toBeNull();
    expect(previewOf(tpl({ body: '' })).body).toBe('(empty body)');
  });
});

describe('audience helpers', () => {
  it('toggle adds and removes', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('search matches name or phone; the display name falls back', () => {
    expect(matchesSearch({ name: 'Asha Rao', phone: '+91 98' }, 'rao')).toBe(true);
    expect(matchesSearch({ name: 'Asha', phone: '+91 98765' }, '9876')).toBe(true);
    expect(matchesSearch({ name: 'Asha', phone: '' }, 'zzz')).toBe(false);
    expect(matchesSearch({ name: 'x', phone: '' }, '  ')).toBe(true);
    expect(contactName({ id: 'abcdef1234', name: '  ', firstName: 'A', lastName: 'B' })).toBe(
      'A B',
    );
    expect(contactName({ id: 'abcdef1234', name: null, firstName: null, lastName: null })).toBe(
      'Contact #abcdef12',
    );
  });
});
