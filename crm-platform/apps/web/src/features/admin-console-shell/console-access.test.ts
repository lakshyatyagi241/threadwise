import { describe, expect, it } from 'vitest';
import { pageVisibleTo, restrictedPageIds } from './console-access';
import { CONSOLE_LAYOUT } from './console-layout';
import { CONSOLE_NAV_ITEMS, buildConsoleNav, isGroup, leaves } from './console-nav';

describe('what the menu offers each operator role', () => {
  it('offers every page to every role unless the page is listed as restricted', () => {
    const open = CONSOLE_NAV_ITEMS.filter((i) => !restrictedPageIds().includes(i.id));
    for (const role of ['super_admin', 'support', 'auditor'] as const) {
      for (const item of open)
        expect(pageVisibleTo(role, item.id), `${role} ${item.id}`).toBe(true);
    }
  });

  it('always offers a super admin everything', () => {
    for (const item of CONSOLE_NAV_ITEMS) expect(pageVisibleTo('super_admin', item.id)).toBe(true);
  });

  it('keeps support out of the pages whose whole API is closed to it', () => {
    expect(pageVisibleTo('support', 'ai-keys')).toBe(false);
    expect(pageVisibleTo('support', 'platform-analytics')).toBe(false);
    expect(pageVisibleTo('auditor', 'platform-analytics')).toBe(true);
    expect(pageVisibleTo('auditor', 'webhook-forwarding')).toBe(false);
    expect(pageVisibleTo('auditor', 'waboo-migration')).toBe(false);
    expect(pageVisibleTo('support', 'waboo-migration')).toBe(false);
    expect(pageVisibleTo('super_admin', 'waboo-migration')).toBe(true);
    expect(pageVisibleTo('support', 'settings-whatsapp')).toBe(false);
    expect(pageVisibleTo('auditor', 'settings-whatsapp')).toBe(false);
  });

  it('only restricts pages that exist', () => {
    const ids = CONSOLE_NAV_ITEMS.map((i) => i.id);
    expect(restrictedPageIds().filter((id) => !ids.includes(id))).toEqual([]);
  });

  it('shortens the rail for support without emptying a hub into a dead link', () => {
    const support = buildConsoleNav(CONSOLE_NAV_ITEMS, CONSOLE_LAYOUT, (id) =>
      pageVisibleTo('support', id),
    );
    const all = buildConsoleNav(CONSOLE_NAV_ITEMS);
    expect(leaves(support).length).toBeLessThan(leaves(all).length);
    for (const hub of support.filter(isGroup)) expect(hub.children.length).toBeGreaterThan(0);
  });
});
