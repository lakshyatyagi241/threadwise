import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from '@/features/admin-console-shell/console-nav';
import { MODULE_NAV_GROUP, withModuleLeaves } from './module-nav';

const base: ConsoleEntry[] = [
  { id: 'overview', href: '/admin', labelKey: 'x' },
  {
    id: MODULE_NAV_GROUP,
    labelKey: MODULE_NAV_GROUP,
    children: [{ id: 'system', href: '/admin/system', labelKey: 'y' }],
  },
];
const item = (key: string, href: string, label = key) => ({
  key,
  href,
  label,
  icon: null,
  after: '',
  module: 'reports',
});

describe('module navigation in the console rail (TW-ADD-012)', () => {
  it('appends active modules to the end of the Apps & modules section with their literal label', () => {
    const out = withModuleLeaves(base, [item('reports', '/admin/reports', 'Reports')]);
    const group = out[1] as Extract<ConsoleEntry, { children: unknown }>;
    expect(group.children.map((c) => c.id)).toEqual(['system', 'module-reports-reports']);
    expect(group.children[1]).toMatchObject({ href: '/admin/reports', label: 'Reports' });
  });

  it('skips the instagram entry (it is a card on the channel settings hub) and items with no href', () => {
    const out = withModuleLeaves(base, [item('instagram', '/instagram'), item('bad', '')]);
    expect((out[1] as { children: unknown[] }).children).toHaveLength(1);
  });

  it('adds an app-relative slash, and creates the group when the rail has none', () => {
    const out = withModuleLeaves([base[0]!], [item('x', 'x-page')]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      id: MODULE_NAV_GROUP,
      labelKey: 'admin-console-shell.nav.sections.apps',
      icon: 'modules',
    });
    expect((out[1] as { children: Array<{ href: string }> }).children[0]!.href).toBe('/x-page');
  });

  it('changes nothing when no module contributes, and never mutates its input', () => {
    expect(withModuleLeaves(base, undefined)).toEqual(base);
    withModuleLeaves(base, [item('r', '/r')]);
    expect((base[1] as { children: unknown[] }).children).toHaveLength(1);
  });
});
