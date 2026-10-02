import { describe, expect, it, vi } from 'vitest';
import {
  NAV_LAYOUT_DEFAULT_BAR,
  navMoreZone,
  normalizeNavBar,
  resolveNavBar,
  saveNavLayoutRequestSchema,
} from '@crm/contracts';
import { NavLayoutService } from '../../../src/modules/admin-console-shell/nav-layout.service';

function service(stored?: unknown) {
  const set = vi.fn().mockResolvedValue(undefined);
  const record = vi.fn().mockResolvedValue(undefined);
  const svc = new NavLayoutService(
    { get: vi.fn().mockResolvedValue(stored), set } as never,
    { recordStandalone: record } as never,
  );
  return { svc, set, record };
}

describe('normalizeNavBar (WD-ASHELL-009 rules)', () => {
  it('appends "more" when a save omits it', () => {
    expect(normalizeNavBar(['dashboard', 'flows']).at(-1)).toBe('more');
  });
  it('drops unknown keys and duplicates, keeps order', () => {
    expect(normalizeNavBar(['flows', 'foo', 'dashboard', 'flows', 'more'])).toEqual([
      'flows',
      'dashboard',
      'more',
    ]);
  });
  it('falls back to the one canonical default when nothing usable is left', () => {
    expect(normalizeNavBar(['foo'])).toEqual([...NAV_LAYOUT_DEFAULT_BAR]);
    expect(normalizeNavBar(['more'])).toEqual([...NAV_LAYOUT_DEFAULT_BAR]);
    expect(normalizeNavBar(null)).toEqual([...NAV_LAYOUT_DEFAULT_BAR]);
  });
  it('moves Broadcasts into the bar right after Flows', () => {
    const bar = normalizeNavBar(['dashboard', 'flows', 'broadcasts', 'more']);
    expect(bar.indexOf('broadcasts')).toBe(bar.indexOf('flows') + 1);
    expect(navMoreZone(bar)).not.toContain('broadcasts');
  });
});

describe('resolveNavBar', () => {
  it('reads the legacy flat list, keeping only default-bar keys', () => {
    expect(resolveNavBar(['flows', 'contacts', 'dashboard'])).toEqual([
      'flows',
      'dashboard',
      'more',
    ]);
  });
  it('treats missing or malformed values as the default', () => {
    for (const v of [undefined, null, 'x', {}, { bar: 'x' }, []])
      expect(resolveNavBar(v)).toEqual([...NAV_LAYOUT_DEFAULT_BAR]);
  });
});

describe('NavLayoutService', () => {
  it('a fresh install and a reset-then-saved layout are identical (WaDesk mismatch fixed)', async () => {
    const fresh = await service(undefined).svc.get();
    const { svc, set } = service();
    await svc.reset(1);
    expect(set).toHaveBeenCalledWith('shell.nav_layout', { bar: fresh.bar }, 1);
    expect(fresh.isDefault).toBe(true);
  });
  it('stores the normalised bar and audits the save', async () => {
    const { svc, set, record } = service();
    const out = await svc.save(7, ['dashboard', 'foo', 'flows']);
    expect(set).toHaveBeenCalledWith(
      'shell.nav_layout',
      { bar: ['dashboard', 'flows', 'more'] },
      7,
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'platform.shell.nav_layout_saved', actorId: 7 }),
    );
    expect(out.isDefault).toBe(false);
    expect(out.more).not.toContain('flows');
  });
  it('request schema accepts a list and rejects a non-list', () => {
    expect(saveNavLayoutRequestSchema.safeParse({ bar: ['a'] }).success).toBe(true);
    expect(saveNavLayoutRequestSchema.safeParse({ bar: 'a' }).success).toBe(false);
  });
});
