import { describe, expect, it } from 'vitest';
import {
  bodyAfterTemplate,
  buttonChips,
  canCreate,
  isHttpUrl,
  previewText,
  toggled,
} from './compose-model';

const tpl = { id: '1', name: 'Offer', body: 'Offer for {{name}}', buttons: [] };

describe('previewText', () => {
  it('shows both placeholder forms as "there" and trims', () => {
    expect(previewText(' Hi {name}! ')).toBe('Hi there!');
    expect(previewText('Hi {{name}} and {{ name }}')).toBe('Hi there and there');
  });
});

describe('bodyAfterTemplate', () => {
  it('fills an empty message and never overwrites typed text', () => {
    expect(bodyAfterTemplate('  ', tpl)).toBe('Offer for {{name}}');
    expect(bodyAfterTemplate('mine', tpl)).toBe('mine');
    expect(bodyAfterTemplate('', undefined)).toBe('');
  });
});

describe('buttonChips', () => {
  it('reads text, title or label, marks links, and skips blanks and junk', () => {
    expect(
      buttonChips([
        { type: 'url', text: 'Shop' },
        { type: 'quick_reply', title: ' Yes ' },
        { label: 'Call' },
        { text: '' },
        null,
        5,
      ]),
    ).toEqual([
      { label: 'Shop', link: true },
      { label: 'Yes', link: false },
      { label: 'Call', link: false },
    ]);
    expect(buttonChips('nope')).toEqual([]);
  });
});

describe('canCreate', () => {
  const ok = { name: 'Promo', channelId: 'c', body: 'x', mediaUrl: '', selected: new Set(['U1']) };
  it('needs a name, a channel, a person and a message or a file', () => {
    expect(canCreate(ok)).toBe(true);
    expect(canCreate({ ...ok, name: ' ' })).toBe(false);
    expect(canCreate({ ...ok, channelId: '' })).toBe(false);
    expect(canCreate({ ...ok, selected: new Set() })).toBe(false);
    expect(canCreate({ ...ok, body: '' })).toBe(false);
    expect(canCreate({ ...ok, body: '', mediaUrl: 'https://x.test/a.png' })).toBe(true);
  });
});

describe('isHttpUrl', () => {
  it('accepts only http and https addresses', () => {
    expect(isHttpUrl('https://cdn.test/a.png')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });
});

describe('toggled', () => {
  it('adds a missing id, removes a present one and never changes the original set', () => {
    const base = new Set(['U1']);
    expect([...toggled(base, 'U2')]).toEqual(['U1', 'U2']);
    expect([...toggled(base, 'U1')]).toEqual([]);
    expect([...base]).toEqual(['U1']);
  });
});
