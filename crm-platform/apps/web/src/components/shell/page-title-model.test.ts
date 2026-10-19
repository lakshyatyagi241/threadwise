import { describe, expect, it } from 'vitest';
import { NAV } from '@/features/_registry/nav.generated';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { loadMessages } from '@/i18n/messages';
import { documentTitle, pageLabelKey } from './page-title-model';

// The registries as the menu sees them for a person who may open everything (the gates only lock or hide, they never rename).
const nav: ResolvedNavItem[] = NAV.map((n) => ({ ...n, locked: false, comingSoon: false }));
const tiles: ResolvedSettingsTile[] = SETTINGS.map((t) => ({
  ...t,
  locked: false,
  comingSoon: false,
}));

describe('pageLabelKey', () => {
  it('names every real menu entry and Settings tile, so a new page is titled by being registered', () => {
    for (const n of nav.filter((i) => !i.comingSoon)) {
      expect(pageLabelKey(n.href, nav, tiles), n.id).toBeTruthy();
    }
    for (const t of tiles.filter((i) => !i.comingSoon)) {
      expect(pageLabelKey(t.href, nav, tiles), t.id).toBeTruthy();
    }
  });

  it('every key it returns is a message that exists in English', () => {
    const messages = loadMessages('en') as Record<string, unknown>;
    const has = (key: string) =>
      key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages) !==
      undefined;
    const keys = new Set<string>();
    for (const n of nav.filter((i) => !i.comingSoon)) keys.add(pageLabelKey(n.href, nav, tiles)!);
    for (const t of tiles.filter((i) => !i.comingSoon)) keys.add(pageLabelKey(t.href, nav, tiles)!);
    for (const s of [
      'channels',
      'data',
      'business',
      'people',
      'automation',
      'integrations',
      'security',
    ]) {
      keys.add(pageLabelKey(`/settings/${s}`, nav, tiles)!);
    }
    for (const k of keys) expect(has(k), k).toBe(true);
  });

  it('uses the longest matching address and covers sub-pages', () => {
    const n = [
      { id: 'a', href: '/appointments', labelKey: 'nav.a', comingSoon: false },
      { id: 'c', href: '/contacts', labelKey: 'nav.c', comingSoon: false },
      { id: 's', href: '/soon', labelKey: 'nav.soon', comingSoon: true },
    ] as never;
    const t = [
      { id: 'at', href: '/appointments/types', labelKey: 'tile.at', comingSoon: false },
    ] as never;
    expect(pageLabelKey('/appointments', n, t)).toBe('nav.a');
    expect(pageLabelKey('/appointments/types', n, t)).toBe('tile.at');
    expect(pageLabelKey('/contacts/42', n, t)).toBe('nav.c');
    expect(pageLabelKey('/contacts-archive', n, t)).toBeUndefined();
    expect(pageLabelKey('/soon', n, t)).toBeUndefined();
    expect(pageLabelKey('/nowhere', n, t)).toBeUndefined();
  });

  it('names a Settings section page by its section', () => {
    expect(pageLabelKey('/settings/people', [], [])).toBe('settings.sections.people.title');
    expect(pageLabelKey('/settings/not-a-section', [], [])).toBeUndefined();
  });
});

describe('documentTitle', () => {
  const base = { workspace: 'WABO DEMO', brand: 'Desk' };
  it('is "<Page> | <Workspace>"', () => {
    expect(documentTitle({ ...base, label: 'Contacts', serverTitle: 'Desk' })).toBe(
      'Contacts | WABO DEMO',
    );
  });
  it('keeps the words of a page that set its own title through the site template', () => {
    expect(documentTitle({ ...base, label: 'Contacts', serverTitle: 'Asha Verma - Desk' })).toBe(
      'Asha Verma | WABO DEMO',
    );
  });
  it('falls back to the product name when the workspace has no name, and to nothing when no page is named', () => {
    expect(
      documentTitle({ label: 'Inbox', workspace: ' ', brand: 'Desk', serverTitle: null }),
    ).toBe('Inbox | Desk');
    expect(documentTitle({ ...base, label: '', serverTitle: 'Desk' })).toBeNull();
  });
});
