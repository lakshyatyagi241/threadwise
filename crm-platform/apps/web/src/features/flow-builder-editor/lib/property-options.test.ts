import { describe, expect, it } from 'vitest';
import { savePropertyOptions } from './property-options';

const feed = {
  system: [
    { key: 'name', name: 'Name' },
    { key: 'email', name: 'Email' },
    { key: 'phone_number', name: 'Phone number' },
  ],
  custom: [{ key: 'plan', name: 'Plan' }],
};

const builtIn = [
  { key: 'name', name: 'Name' },
  { key: 'first_name', name: 'first_name' },
  { key: 'last_name', name: 'last_name' },
  { key: 'email', name: 'Email' },
  { key: 'title', name: 'title' },
  { key: 'language', name: 'language' },
  { key: 'address', name: 'address' },
];

describe('savePropertyOptions', () => {
  it('offers the writable contact columns and the custom properties, never the read-only tokens', () => {
    const keys = savePropertyOptions(feed, '').map((p) => p.key);
    expect(keys).toEqual([...builtIn.map((p) => p.key), 'plan']);
    expect(keys).not.toContain('phone_number');
  });

  it('keeps a stored writable column once, without a duplicate', () => {
    expect(savePropertyOptions(feed, 'email')).toEqual([...builtIn, { key: 'plan', name: 'Plan' }]);
  });

  it('keeps a stored custom property once, without a duplicate', () => {
    expect(savePropertyOptions(feed, 'plan').filter((p) => p.key === 'plan')).toHaveLength(1);
  });

  it('keeps a stored key that is not writable under its own name, so the select shows it', () => {
    expect(savePropertyOptions(feed, 'phone_number')[0]).toEqual({
      key: 'phone_number',
      name: 'Phone number',
    });
  });

  it('keeps an unknown stored key under its own name', () => {
    expect(savePropertyOptions(feed, 'gone')[0]).toEqual({ key: 'gone', name: 'gone' });
  });

  it('copes with the feed not loaded yet', () => {
    expect(savePropertyOptions(undefined, '').map((p) => p.key)).toEqual(builtIn.map((p) => p.key));
    expect(savePropertyOptions(undefined, 'email')).toContainEqual({ key: 'email', name: 'email' });
  });
});
