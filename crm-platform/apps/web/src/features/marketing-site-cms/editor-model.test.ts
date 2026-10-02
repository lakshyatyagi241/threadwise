import { describe, expect, it } from 'vitest';
import type { CmsEntry, CmsField } from '@crm/contracts';
import { dirtyDrafts, effectiveValue, hasPendingDraft } from './editor-model';

const field: CmsField = { key: 'title', type: 'text', label: 'Title', default: 'Hello' };
const entry = (draft: string | null, published: string | null): CmsEntry => ({
  key: 'home.hero.title',
  type: 'text',
  draft,
  published,
  rowVersion: 3,
});

describe('effectiveValue', () => {
  it('prefers the draft, then published, then the default', () => {
    expect(effectiveValue(entry('d', 'p'), field)).toBe('d');
    expect(effectiveValue(entry(null, 'p'), field)).toBe('p');
    expect(effectiveValue(undefined, field)).toBe('Hello');
  });
  it('treats an empty string as "use the default"', () => {
    expect(effectiveValue(entry('', 'p'), field)).toBe('Hello');
  });
});

describe('hasPendingDraft', () => {
  it('is true only when a draft differs from the live value', () => {
    expect(hasPendingDraft(entry('d', 'p'))).toBe(true);
    expect(hasPendingDraft(entry('p', 'p'))).toBe(false);
    expect(hasPendingDraft(entry(null, 'p'))).toBe(false);
    expect(hasPendingDraft(undefined)).toBe(false);
  });
});

describe('dirtyDrafts', () => {
  const entries = new Map([['home.hero.title', entry(null, 'p')]]);
  const fields = new Map([
    ['home.hero.title', field],
    ['home.hero.sub', { ...field, key: 'sub' }],
  ]);
  it('sends only changed known keys, with the row version when the row exists', () => {
    const out = dirtyDrafts(
      { 'home.hero.title': 'new', 'home.hero.sub': 'Hello', 'nope.x': 'y' },
      entries,
      fields,
    );
    expect(out).toEqual([{ key: 'home.hero.title', value: 'new', rowVersion: 3 }]);
  });
  it('sends a brand-new key without a row version', () => {
    expect(dirtyDrafts({ 'home.hero.sub': 'x' }, entries, fields)).toEqual([
      { key: 'home.hero.sub', value: 'x' },
    ]);
  });
});
