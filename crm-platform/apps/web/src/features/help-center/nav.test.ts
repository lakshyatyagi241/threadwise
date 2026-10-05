import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV } from '@/features/_registry/nav.generated';
import { CAPABILITIES_UNKNOWN, resolveNav } from '@/features/_registry/resolve';
import { activeNavId, menuItems, toSections } from '@/components/shell/nav-model';
import { hasNavIcon } from '@/components/shell/nav-icons';

const WEB = join(__dirname, '..', '..', '..');
const items = resolveNav(NAV, CAPABILITIES_UNKNOWN);

describe('the Help menu entry', () => {
  it('is pinned with Settings, directly above it', () => {
    expect(items.filter((i) => i.group === 'settings').map((i) => i.id)).toEqual([
      'help-center',
      'settings',
    ]);
    const pinned = toSections(menuItems(items)).find((s) => s.group === 'settings');
    expect(pinned?.items.map((i) => i.id)).toEqual(['help-center', 'settings']);
  });

  it('points at /help, uses the Help label and an icon the shell can draw', () => {
    const help = items.find((i) => i.id === 'help-center')!;
    expect(help.href).toBe('/help');
    expect(help.labelKey).toBe('shell.help');
    expect(hasNavIcon(help.icon)).toBe(true);
  });

  it('lights up on /help and every guide, not on a lookalike address', () => {
    expect(activeNavId(items, [], '/help')).toBe('help-center');
    expect(activeNavId(items, [], '/help/getting-started')).toBe('help-center');
    expect(activeNavId(items, [], '/helpful')).toBeUndefined();
    expect(activeNavId(items, [], '/settings')).toBe('settings');
  });
});

describe('the pinned menu landmark', () => {
  it('is labelled for what it holds now (Help and Settings), in both languages', () => {
    for (const locale of ['en', 'ar']) {
      const shell = JSON.parse(
        readFileSync(join(WEB, 'messages', locale, 'shell.json'), 'utf8'),
      ) as { shell: Record<string, unknown> };
      expect(typeof shell.shell.pinned, locale).toBe('string');
    }
  });

  it('is what the rail and the drawer use, not the plain Settings label', () => {
    const rail = readFileSync(join(WEB, 'src', 'components', 'shell', 'nav-rail.tsx'), 'utf8');
    expect(rail).not.toContain("aria-label={t('shell.settings')}");
    expect(rail.match(/aria-label=\{t\('shell\.pinned'\)\}/g)).toHaveLength(2);
  });
});
