import { describe, expect, it } from 'vitest';
import type { PermissionDefResponse } from '@crm/contracts';
import {
  applyTemplate,
  countDenied,
  countSelected,
  draftFromGrants,
  filterDefs,
  grantsFromDraft,
  groupByCategory,
  needsTeamWarning,
  sameDraft,
  scopeOptions,
  setEffect,
  setMany,
  setScope,
  toggleKey,
  triState,
} from './matrix';

const D = (
  key: string,
  label: string,
  category: string,
  supportsScope = false,
): PermissionDefResponse => ({
  key,
  label,
  category,
  supportsScope,
});
const defs = [
  D('record.contacts.read', 'Read contacts', 'Contacts', true),
  D('record.contacts.update', 'Edit contacts', 'Contacts', true),
  D('admin.role.manage', 'Manage roles', 'Admin'),
];

describe('groupByCategory / filterDefs', () => {
  it('groups by category alphabetically and sorts by label', () => {
    const g = groupByCategory(defs);
    expect(g.map((x) => x.category)).toEqual(['Admin', 'Contacts']);
    expect(g[1]!.keys).toEqual(['record.contacts.update', 'record.contacts.read']);
  });
  it('searches label, key and category', () => {
    expect(filterDefs(defs, 'edit').map((d) => d.key)).toEqual(['record.contacts.update']);
    expect(filterDefs(defs, 'ADMIN.ROLE')).toHaveLength(1);
    expect(filterDefs(defs, 'contacts')).toHaveLength(2);
    expect(filterDefs(defs, '  ')).toHaveLength(3);
  });
});

describe('draft helpers', () => {
  it('toggles a key on as allow/all and off again', () => {
    const on = toggleKey(new Map(), 'a');
    expect(on.get('a')).toEqual({ effect: 'allow', recordScope: 'all' });
    expect(toggleKey(on, 'a').size).toBe(0);
  });
  it('changes effect and scope only for granted keys', () => {
    const d = toggleKey(new Map(), 'a');
    expect(setEffect(d, 'a', 'deny').get('a')?.effect).toBe('deny');
    expect(setScope(d, 'a', 'own').get('a')?.recordScope).toBe('own');
    expect(setScope(d, 'b', 'own')).toBe(d);
    expect(countDenied(setEffect(d, 'a', 'deny'))).toBe(1);
  });
  it('select-all ticks the missing keys, keeps existing grants and clears on off', () => {
    const start = setScope(toggleKey(new Map(), 'a'), 'a', 'own');
    const all = setMany(start, ['a', 'b'], true);
    expect(all.get('a')?.recordScope).toBe('own');
    expect(triState(all, ['a', 'b'])).toBe('all');
    expect(triState(start, ['a', 'b'])).toBe('some');
    expect(triState(start, ['x'])).toBe('none');
    expect(triState(start, [])).toBe('none');
    expect(setMany(all, ['a', 'b'], false).size).toBe(0);
    expect(countSelected(all, ['a'])).toBe(1);
    expect(countSelected(all)).toBe(2);
  });
  it('serialises sorted and forces scope all where a key has no scope', () => {
    const draft = draftFromGrants([
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' },
      { permissionKey: 'admin.role.manage', effect: 'deny', recordScope: 'team' },
    ]);
    expect(grantsFromDraft(draft, defs)).toEqual([
      { permissionKey: 'admin.role.manage', effect: 'deny', recordScope: 'all' },
      { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' },
    ]);
  });
  it('templates drop keys the catalogue lacks and blank clears', () => {
    const t = applyTemplate(
      ['a'],
      [
        { permissionKey: 'a', effect: 'deny', recordScope: 'all' },
        { permissionKey: 'gone', effect: 'allow', recordScope: 'all' },
      ],
    );
    expect([...t.keys()]).toEqual(['a']);
    expect(applyTemplate(['a'], null).size).toBe(0);
  });
  it('compares drafts by key, effect and scope', () => {
    const a = toggleKey(new Map(), 'a');
    expect(sameDraft(a, toggleKey(new Map(), 'a'))).toBe(true);
    expect(sameDraft(a, setEffect(a, 'a', 'deny'))).toBe(false);
    expect(sameDraft(a, new Map())).toBe(false);
  });
});

describe('scopeOptions', () => {
  it('lists the four scopes widest first, with team_and_below between all and team', () => {
    expect(scopeOptions(true)).toEqual(['all', 'team_and_below', 'team', 'own']);
  });
  it('leaves team_and_below out when the hierarchy feature is off', () => {
    expect(scopeOptions(false)).toEqual(['all', 'team', 'own']);
    expect(scopeOptions(false, 'team')).toEqual(['all', 'team', 'own']);
  });
  it('keeps a team_and_below value the plan no longer offers', () => {
    expect(scopeOptions(false, 'team_and_below')).toEqual(['all', 'team_and_below', 'team', 'own']);
  });
});

describe('needsTeamWarning', () => {
  const scoped = [{ key: 'contact.read', supportsScope: true }];
  const draftOf = (effect: 'allow' | 'deny', recordScope: 'all' | 'team' | 'team_and_below' | 'own') =>
    new Map([['contact.read', { effect, recordScope }]]);

  it('warns for an allow at team or team_and_below when members have no team', () => {
    expect(needsTeamWarning(draftOf('allow', 'team'), 2, scoped)).toBe(true);
    expect(needsTeamWarning(draftOf('allow', 'team_and_below'), 1, scoped)).toBe(true);
  });
  it('stays quiet for all, own, a deny, no members without a team, or a key without scope', () => {
    expect(needsTeamWarning(draftOf('allow', 'all'), 2, scoped)).toBe(false);
    expect(needsTeamWarning(draftOf('allow', 'own'), 2, scoped)).toBe(false);
    expect(needsTeamWarning(draftOf('deny', 'team'), 2, scoped)).toBe(false);
    expect(needsTeamWarning(draftOf('allow', 'team'), 0, scoped)).toBe(false);
    expect(needsTeamWarning(draftOf('allow', 'team'), undefined, scoped)).toBe(false);
    expect(needsTeamWarning(draftOf('allow', 'team'), 2, [{ key: 'contact.read', supportsScope: false }])).toBe(false);
  });
});
