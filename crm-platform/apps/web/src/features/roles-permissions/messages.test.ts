import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES_OPERATOR_NAV } from './operator-nav';

type Tree = { [key: string]: string | Tree };
const root = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'roles-permissions.json'), 'utf8'),
) as Tree;

const lookup = (path: string): string | Tree | undefined =>
  path
    .split('.')
    .reduce<string | Tree | undefined>(
      (node, part) => (typeof node === 'object' ? node[part] : undefined),
      root,
    );

describe('roles-permissions messages', () => {
  it('never uses a dot inside a key (next-intl reads it as nesting)', () => {
    const dotted: string[] = [];
    const walk = (t: Tree) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(k);
        if (typeof v !== 'string') walk(v);
      }
    };
    walk(root);
    expect(dotted).toEqual([]);
  });

  it('has a label and a group heading for every console menu entry', () => {
    for (const item of ROLES_OPERATOR_NAV) {
      expect(typeof lookup(item.labelKey)).toBe('string');
      expect(typeof lookup(item.groupKey)).toBe('string');
    }
  });

  it('keeps the exact Reference flash copy', () => {
    expect(lookup('roles-permissions.editor.toasts.created')).toBe('Role "{name}" created.');
    expect(lookup('roles-permissions.editor.toasts.updated')).toBe('Role "{name}" updated.');
    expect(lookup('roles-permissions.list.toasts.deleted')).toBe('Role "{name}" deleted.');
    expect(lookup('roles-permissions.editor.duplicatedBanner')).toBe(
      'Role duplicated as "{name}". Edit the copy below.',
    );
    expect(lookup('roles-permissions.dangerZone.moved')).toBe(
      '{count} user(s) moved from "{from}" to "{to}".',
    );
    expect(lookup('roles-permissions.common.errors.lockedDelete')).toBe(
      'Super Admin role is system-locked and cannot be deleted.',
    );
    expect(lookup('roles-permissions.permissionNew.toasts.created')).toBe(
      'Permission "{name}" created.',
    );
    expect(lookup('roles-permissions.permissions.toasts.deleted')).toBe(
      'Permission "{name}" deleted.',
    );
  });
});
