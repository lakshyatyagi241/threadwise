import { describe, expect, it } from 'vitest';
import { bodyAfterTemplate, canCreate, isTagId, type ComposeDraft } from './compose-model';

const draft = (over: Partial<ComposeDraft> = {}): ComposeDraft => ({
  name: 'Sale',
  channelId: 'c1',
  audience: 'all',
  tagId: '',
  body: 'Hello',
  selected: new Set(),
  ...over,
});

describe('canCreate', () => {
  it('all followers need only a name, a channel and a message', () => {
    expect(canCreate(draft())).toBe(true);
    expect(canCreate(draft({ name: '  ' }))).toBe(false);
    expect(canCreate(draft({ channelId: '' }))).toBe(false);
    expect(canCreate(draft({ body: ' ' }))).toBe(false);
  });

  it('a tag needs its number', () => {
    expect(canCreate(draft({ audience: 'tag' }))).toBe(false);
    expect(canCreate(draft({ audience: 'tag', tagId: 'abc' }))).toBe(false);
    expect(canCreate(draft({ audience: 'tag', tagId: '107' }))).toBe(true);
    expect(canCreate(draft({ audience: 'tag', tagId: '0' }))).toBe(true);
  });

  it('picked users need at least two (WeChat takes no OpenID mass send for one)', () => {
    expect(canCreate(draft({ audience: 'list' }))).toBe(false);
    expect(canCreate(draft({ audience: 'list', selected: new Set(['a']) }))).toBe(false);
    expect(canCreate(draft({ audience: 'list', selected: new Set(['a', 'b']) }))).toBe(true);
  });

  it('a tag typed earlier does not matter once another audience is picked', () => {
    expect(canCreate(draft({ audience: 'all', tagId: 'junk' }))).toBe(true);
  });
});

describe('isTagId', () => {
  it('is digits only, up to ten of them', () => {
    expect(isTagId('2')).toBe(true);
    expect(isTagId(' 12 ')).toBe(true);
    expect(isTagId('')).toBe(false);
    expect(isTagId('1.5')).toBe(false);
    expect(isTagId('-1')).toBe(false);
    expect(isTagId('12345678901')).toBe(false);
  });
});

describe('bodyAfterTemplate', () => {
  it('fills an empty message and never overwrites typed text', () => {
    expect(bodyAfterTemplate('', { body: 'From template' })).toBe('From template');
    expect(bodyAfterTemplate('  ', { body: 'From template' })).toBe('From template');
    expect(bodyAfterTemplate('mine', { body: 'From template' })).toBe('mine');
    expect(bodyAfterTemplate('', undefined)).toBe('');
  });
});
