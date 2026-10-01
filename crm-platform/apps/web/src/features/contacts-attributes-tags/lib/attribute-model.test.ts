import type { AttributeResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkAttributeKey,
  filterPicker,
  findSlashQuery,
  insertToken,
  suggestKey,
  toAttribute,
  type PickerEntry,
} from './attribute-model';

describe('toAttribute', () => {
  const dto = {
    id: 'a1',
    key: 'order_id',
    name: 'Order ID',
    type: 'text',
    defaultValue: 'N/A',
    description: 'Shop order',
    isActive: true,
    rowVersion: 4,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  } satisfies AttributeResponse;

  it('maps the API attribute', () => {
    expect(toAttribute(dto)).toEqual({
      id: 'a1',
      name: 'Order ID',
      key: 'order_id',
      defaultValue: 'N/A',
      description: 'Shop order',
      active: true,
      rowVersion: 4,
    });
  });

  it('turns missing default and description into empty text for the form', () => {
    expect(
      toAttribute({ ...dto, defaultValue: null, description: null, isActive: false }),
    ).toMatchObject({
      defaultValue: '',
      description: '',
      active: false,
    });
  });
});

describe('checkAttributeKey (TW-CON-043)', () => {
  it('accepts lower-case snake_case', () => {
    expect(checkAttributeKey('order_id')).toBeNull();
    expect(checkAttributeKey('a1_b2')).toBeNull();
  });

  it('rejects the keys Reference let through', () => {
    expect(checkAttributeKey('')).toBe('required');
    expect(checkAttributeKey('order id')).toBe('format');
    expect(checkAttributeKey('Order_ID')).toBe('format');
    expect(checkAttributeKey('1abc')).toBe('format');
    expect(checkAttributeKey('order-id')).toBe('format');
    expect(checkAttributeKey('a'.repeat(65))).toBe('tooLong');
  });
});

describe('suggestKey', () => {
  it('turns a display name into a key', () => {
    expect(suggestKey('Order ID')).toBe('order_id');
    expect(suggestKey('  Café Total (EUR) ')).toBe('cafe_total_eur');
    expect(suggestKey('123 go')).toBe('go');
    expect(suggestKey('!!!')).toBe('');
  });
});

describe('picker filter (TW-CON-046)', () => {
  const feed: PickerEntry[] = [
    { kind: 'system', key: 'first_name', name: 'First name', description: '' },
    { kind: 'custom', key: 'order_id', name: 'Order ID', description: 'shop order' },
  ];

  it('filters by key, name or description', () => {
    expect(filterPicker(feed, 'ord').map((e) => e.key)).toEqual(['order_id']);
    expect(filterPicker(feed, 'shop').map((e) => e.key)).toEqual(['order_id']);
    expect(filterPicker(feed, 'FIRST').map((e) => e.key)).toEqual(['first_name']);
    expect(filterPicker(feed, '')).toHaveLength(2);
    expect(filterPicker(feed, 'zzz')).toEqual([]);
  });
});

describe('slash query', () => {
  it('opens when "/" starts a token and returns what was typed after it', () => {
    expect(findSlashQuery('/', 1)).toEqual({ start: 0, query: '' });
    expect(findSlashQuery('Hello /ord', 10)).toEqual({ start: 6, query: 'ord' });
  });

  it('does not open for a slash inside a word or url', () => {
    expect(findSlashQuery('a/b', 3)).toBeNull();
    expect(findSlashQuery('https://x.io', 12)).toBeNull();
  });

  it('closes once the query has whitespace or is longer than 24 characters', () => {
    expect(findSlashQuery('/ord er', 7)).toBeNull();
    expect(findSlashQuery(`/${'a'.repeat(25)}`, 26)).toBeNull();
    expect(findSlashQuery(`/${'a'.repeat(24)}`, 25)).not.toBeNull();
  });

  it('is about the caret, not the end of the text', () => {
    expect(findSlashQuery('/ord rest', 4)).toEqual({ start: 0, query: 'ord' });
  });

  it('replaces "/query" with the named token and moves the caret past it', () => {
    expect(insertToken('Hi /ord there', 7, 3, 'order_id')).toEqual({
      text: 'Hi {{order_id}} there',
      caret: 15,
    });
  });
});
