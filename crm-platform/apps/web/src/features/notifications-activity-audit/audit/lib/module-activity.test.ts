import { describe, expect, it } from 'vitest';
import { matchesActivity } from './module-activity';

const entry = {
  actor: { kind: 'user' as const, id: '0f4f5c1e-7a1b-4c52-9d1e-2b8f1c3a4d01', name: 'Asha Rao' },
  action: 'update',
  changedFields: ['name', 'color'],
};

describe('matchesActivity: the search on a module activity panel', () => {
  it('matches everything when the search is empty or only spaces', () => {
    expect(matchesActivity(entry, '', 'Updated')).toBe(true);
    expect(matchesActivity(entry, '   ', 'Updated')).toBe(true);
  });

  it('matches the person who acted, ignoring case', () => {
    expect(matchesActivity(entry, 'asha', 'Updated')).toBe(true);
    expect(matchesActivity(entry, 'RAO', 'Updated')).toBe(true);
    expect(matchesActivity(entry, 'ravi', 'Updated')).toBe(false);
  });

  it('matches the action by its stored name and by the word shown for it', () => {
    expect(matchesActivity(entry, 'update', 'Updated')).toBe(true);
    expect(matchesActivity(entry, 'updated', 'Updated')).toBe(true);
    expect(matchesActivity(entry, 'delete', 'Updated')).toBe(false);
  });

  it('matches the names of the fields that changed', () => {
    expect(matchesActivity(entry, 'color', 'Updated')).toBe(true);
    expect(matchesActivity(entry, 'note', 'Updated')).toBe(false);
  });

  it('treats an entry with no person (a system write) as having no name to match', () => {
    const system = { ...entry, actor: { kind: 'system' as const, id: null, name: null } };

    expect(matchesActivity(system, 'asha', 'Updated')).toBe(false);
    expect(matchesActivity(system, 'update', 'Updated')).toBe(true);
  });
});
