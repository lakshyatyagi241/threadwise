import { describe, expect, it } from 'vitest';
import {
  bodyAfterTemplate,
  buttonLabels,
  canCreate,
  isHttpUrl,
  previewText,
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

describe('buttonLabels', () => {
  it('reads text or label and skips blanks and junk', () => {
    expect(buttonLabels([{ text: 'Shop' }, { label: ' Call ' }, { text: '' }, null, 5])).toEqual([
      'Shop',
      'Call',
    ]);
    expect(buttonLabels('nope')).toEqual([]);
  });
});

describe('canCreate', () => {
  const ok = {
    name: 'Promo',
    botId: 'b',
    body: 'x',
    mediaUrl: '',
    selected: new Set(['1']),
  };
  it('needs a name, a bot, a chat and a message or a file', () => {
    expect(canCreate(ok)).toBe(true);
    expect(canCreate({ ...ok, name: ' ' })).toBe(false);
    expect(canCreate({ ...ok, botId: '' })).toBe(false);
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
