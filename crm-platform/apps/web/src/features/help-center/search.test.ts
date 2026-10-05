import { describe, expect, it } from 'vitest';
import { docForPath, matchHelp } from './search';
import type { HelpIndexEntry } from './types';

const entry = (id: string, over: Partial<HelpIndexEntry> = {}): HelpIndexEntry => ({
  id,
  area: 'sales',
  order: 100,
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  keywords: [],
  routes: [],
  headings: [],
  fallback: false,
  ...over,
});

describe('matchHelp', () => {
  const all = [entry('a'), entry('b'), entry('c')];

  it('returns everything in the original order for an empty or blank query', () => {
    expect(matchHelp(all, '').map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(matchHelp(all, '   ').map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('needs every word to match somewhere in the entry', () => {
    const entries = [
      entry('one', { title: 'Import contacts', keywords: ['csv'] }),
      entry('two', { title: 'Import deals' }),
    ];
    expect(matchHelp(entries, 'import csv').map((e) => e.id)).toEqual(['one']);
    expect(matchHelp(entries, 'import').map((e) => e.id)).toEqual(['one', 'two']);
    expect(matchHelp(entries, 'import nothing')).toEqual([]);
  });

  it('ranks a title match above keyword, heading and summary matches', () => {
    const entries = [
      entry('summary', { summary: 'about zeta here' }),
      entry('heading', { headings: [{ id: 'z', text: 'Zeta basics', level: 2 }] }),
      entry('keyword', { keywords: ['zeta'] }),
      entry('title', { title: 'Zeta' }),
    ];
    expect(matchHelp(entries, 'zeta').map((e) => e.id)).toEqual([
      'title',
      'keyword',
      'heading',
      'summary',
    ]);
  });

  it('is case-insensitive and treats regex characters literally', () => {
    const entries = [entry('x', { title: 'Tags (labels)' }), entry('y', { title: 'Other' })];
    expect(matchHelp(entries, 'TAGS').map((e) => e.id)).toEqual(['x']);
    expect(matchHelp(entries, '(').map((e) => e.id)).toEqual(['x']);
    expect(matchHelp(entries, '.*')).toEqual([]);
  });
});

describe('docForPath', () => {
  const entries = [
    entry('dash', { routes: ['/'] }),
    entry('contacts', { routes: ['/contacts'] }),
    entry('imports', { routes: ['/contacts/import'] }),
    entry('help-itself', { routes: ['/help'] }),
  ];
  const id = (path: string) => docForPath(entries, path)?.id;

  it('picks the longest route that covers the address', () => {
    expect(id('/contacts')).toBe('contacts');
    expect(id('/contacts/42')).toBe('contacts');
    expect(id('/contacts/import')).toBe('imports');
    expect(id('/contacts/import/step-2')).toBe('imports');
  });

  it('matches / only exactly, and never a lookalike prefix', () => {
    expect(id('/')).toBe('dash');
    expect(id('/other')).toBeUndefined();
    expect(id('/contacts-archive')).toBeUndefined();
  });

  it('ignores a trailing slash, a query and a hash', () => {
    expect(id('/contacts/')).toBe('contacts');
    expect(id('/contacts?page=2')).toBe('contacts');
    expect(id('/contacts#top')).toBe('contacts');
  });

  it('gives no tip on the help pages themselves', () => {
    expect(id('/help')).toBeUndefined();
    expect(id('/help/getting-started')).toBeUndefined();
  });

  it('breaks a tie on order, then id', () => {
    const tie = [
      entry('b', { routes: ['/x'], order: 5 }),
      entry('a', { routes: ['/x'], order: 5 }),
      entry('c', { routes: ['/x'], order: 1 }),
    ];
    expect(docForPath(tie, '/x')?.id).toBe('c');
    expect(docForPath(tie.slice(0, 2), '/x')?.id).toBe('a');
  });
});
