import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { permissionNameSchema } from '@crm/contracts';
import { pgArray } from '../../../src/modules/roles-permissions/pg-array';
import { moduleOf } from '../../../src/modules/roles-permissions/platform-permissions.service';

const dir = join(__dirname, '../../../src/modules/roles-permissions');
const dialect = new PgDialect();

describe('moduleOf (catalogue grouping, WD-RBAC-011)', () => {
  it('groups by the text before the first dot; a name without a dot is its own module', () => {
    expect(moduleOf('users.view')).toBe('users');
    expect(moduleOf('platform.workspace.view_all')).toBe('platform');
    expect(moduleOf('superuser')).toBe('superuser');
  });
});

describe('permissionNameSchema', () => {
  it('takes lowercase dotted segments and refuses the rest', () => {
    for (const ok of [
      'users.view',
      'campaigns.send',
      'platform.workspace.view_all',
      'superuser',
      'a1_b2.c3',
    ]) {
      expect(permissionNameSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      '',
      ' ',
      'Has Space',
      'UPPER.case',
      'trailing.',
      '.leading',
      'a..b',
      'x'.repeat(192),
    ]) {
      expect(permissionNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('pgArray', () => {
  it('builds an array literal of bind parameters, never a row', () => {
    const q = dialect.sqlToQuery(pgArray([1, 2, 3], 'bigint'));
    expect(q.sql).toBe('ARRAY[$1, $2, $3]::bigint[]');
    expect(q.params).toEqual([1, 2, 3]);
  });
  it('builds a typed empty array', () => {
    expect(dialect.sqlToQuery(pgArray([], 'uuid')).sql).toBe('ARRAY[]::uuid[]');
  });
});

describe('module boundary', () => {
  it('reaches the platform tables only through PlatformRbacStore', () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'platform-rbac.store.ts')
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('.privileged('));
    expect(offenders).toEqual([]);
  });
});
