import { describe, expect, it } from 'vitest';
import { filterPermissions } from './permission-filter';

const all = [
  { name: 'users.view', module: 'users' },
  { name: 'users.create', module: 'users' },
  { name: 'campaigns.send', module: 'campaigns' },
  { name: 'platform.audit.view', module: 'platform' },
];

const names = (groups: ReturnType<typeof filterPermissions>) => groups.flatMap((g) => g.names);

describe('filterPermissions', () => {
  it('returns everything, grouped, with no filter', () => {
    expect(filterPermissions(all, '', '').map((g) => g.module)).toEqual([
      'campaigns',
      'platform',
      'users',
    ]);
  });
  it('matches part of a name without regard to case or surrounding space', () => {
    expect(names(filterPermissions(all, '  VIEW ', ''))).toEqual([
      'platform.audit.view',
      'users.view',
    ]);
  });
  it('limits to one module', () => {
    expect(names(filterPermissions(all, '', 'users'))).toEqual(['users.create', 'users.view']);
  });
  it('combines search and module', () => {
    expect(names(filterPermissions(all, 'view', 'users'))).toEqual(['users.view']);
    expect(filterPermissions(all, 'send', 'users')).toEqual([]);
  });
  it('treats search text literally, not as a pattern', () => {
    expect(filterPermissions(all, '.*', '')).toEqual([]);
  });
});
