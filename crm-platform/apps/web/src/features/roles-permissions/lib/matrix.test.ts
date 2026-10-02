import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  capitalise,
  groupPermissions,
  sameSelection,
  selectionToList,
  setMany,
  toggleOne,
  triState,
} from './matrix';

const catalogue = [
  { name: 'users.view', module: 'users' },
  { name: 'campaigns.send', module: 'campaigns' },
  { name: 'users.create', module: 'users' },
  { name: 'platform.role.manage', module: 'platform' },
  { name: 'superuser', module: 'superuser' },
];

describe('groupPermissions', () => {
  it('groups by module, modules and names alphabetical', () => {
    const groups = groupPermissions(catalogue);
    expect(groups.map((g) => [g.module, g.names])).toEqual([
      ['campaigns', ['campaigns.send']],
      ['platform', ['platform.role.manage']],
      ['superuser', ['superuser']],
      ['users', ['users.create', 'users.view']],
    ]);
  });
  it('keeps the original items so a card can read their other fields', () => {
    const [first] = groupPermissions([{ name: 'a.b', module: 'a', roleCount: 3 }]);
    expect(first?.items[0]?.roleCount).toBe(3);
  });
  it('returns nothing for an empty catalogue', () => expect(groupPermissions([])).toEqual([]));
});

describe('capitalise', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalise('metaads')).toBe('Metaads');
    expect(capitalise('')).toBe('');
  });
});

describe('triState', () => {
  const names = ['a', 'b', 'c'];
  it('is none, some or all', () => {
    expect(triState(new Set(), names)).toBe('none');
    expect(triState(new Set(['a']), names)).toBe('some');
    expect(triState(new Set(['a', 'b', 'c']), names)).toBe('all');
  });
  it('ignores ticked names outside the group', () => {
    expect(triState(new Set(['x']), names)).toBe('none');
  });
  it('is none for an empty group', () => expect(triState(new Set(['a']), [])).toBe('none'));
});

describe('setMany / toggleOne', () => {
  it('ticks and unticks a whole module without touching the rest', () => {
    const start = new Set(['x', 'a']);
    expect([...setMany(start, ['a', 'b'], true)].sort()).toEqual(['a', 'b', 'x']);
    expect([...setMany(start, ['a', 'b'], false)]).toEqual(['x']);
  });
  it('never unticks a kept name (a locked role keeps its grants)', () => {
    const start = new Set(['a', 'b', 'c']);
    expect([...setMany(start, ['a', 'b', 'c'], false, new Set(['a']))]).toEqual(['a']);
    expect(setMany(start, ['d'], true, new Set(['a'])).has('d')).toBe(true);
  });
  it('does not mutate its input', () => {
    const start = new Set(['a']);
    setMany(start, ['b'], true);
    toggleOne(start, 'a');
    expect([...start]).toEqual(['a']);
  });
  it('toggles one name', () => {
    expect(toggleOne(new Set(['a']), 'b').has('b')).toBe(true);
    expect(toggleOne(new Set(['a']), 'a').has('a')).toBe(false);
  });
});

describe('applyTemplate', () => {
  const names = ['users.view', 'users.create', 'campaigns.send'];
  it('pre-ticks the template role permissions', () => {
    expect([...applyTemplate(names, ['users.view', 'campaigns.send'])].sort()).toEqual([
      'campaigns.send',
      'users.view',
    ]);
  });
  it('drops names the catalogue no longer has', () => {
    expect([...applyTemplate(names, ['users.view', 'gone.key'])]).toEqual(['users.view']);
  });
  it('Blank clears the selection', () => expect(applyTemplate(names, null).size).toBe(0));
});

describe('selectionToList / sameSelection', () => {
  it('serialises sorted', () => expect(selectionToList(new Set(['b', 'a']))).toEqual(['a', 'b']));
  it('compares selections by content', () => {
    expect(sameSelection(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSelection(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameSelection(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false);
  });
});
