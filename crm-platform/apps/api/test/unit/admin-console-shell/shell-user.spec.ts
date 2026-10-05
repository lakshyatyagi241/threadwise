import { describe, expect, it } from 'vitest';
import {
  QUICK_ACCESS_DEFAULT_KEYS,
  firstName,
  greetingKey,
  groupAnnouncements,
  isLightColor,
  isSafeShortcutUrl,
  marqueeSeconds,
  parseShellMode,
  railTheme,
  resolveQuickAccess,
  sanitizeQuickAccess,
  type AnnouncementRow,
} from '@crm/contracts';

describe('shell mode (WD-ASHELL-011)', () => {
  it('reads topbar unless the setting is exactly sidebar', () => {
    expect(parseShellMode('sidebar')).toBe('sidebar');
    expect(parseShellMode('topbar')).toBe('topbar');
    expect(parseShellMode('grid')).toBe('topbar');
    expect(parseShellMode(undefined)).toBe('topbar');
  });
});

describe('rail colours (WD-ASHELL-011, 015)', () => {
  it('has no override while nothing is customised, so the rail follows the theme', () => {
    expect(railTheme({ color: null, textColor: null, accentColor: null })).toBeNull();
  });
  it('a white background with no text colour gets dark text tokens', () => {
    const t = railTheme({ color: '#FFFFFF', textColor: null, accentColor: null })!;
    expect(isLightColor('#FFFFFF')).toBe(true);
    expect(t.light).toBe(true);
    expect(t.fixedBackground).toBe(true);
    expect(t.vars['--nav-bg']).toBe('#FFFFFF');
    expect(t.vars['--nav-active-foreground']).toBe('#0B1F1C');
  });
  it('a dark background gets light text', () => {
    const t = railTheme({ color: '#06100E', textColor: null, accentColor: null })!;
    expect(t.light).toBe(false);
    expect(t.vars['--nav-active-foreground']).toBe('#F5F3EC');
  });
  it('an explicit text colour derives the 72, 50, 42, 8, 6 and 14 percent scale', () => {
    const t = railTheme({ color: '#06100E', textColor: '#112233', accentColor: null })!;
    expect(t.vars['--nav-foreground']).toContain('#112233 72%');
    expect(t.vars['--nav-muted']).toContain('#112233 50%');
    expect(t.vars['--nav-disabled']).toContain('#112233 42%');
    expect(t.vars['--nav-hover']).toContain('#112233 8%');
    expect(t.vars['--nav-border']).toContain('#112233 6%');
    expect(t.vars['--nav-active']).toContain('#112233 14%');
  });
  it('an accent left unset is the shipped green', () => {
    const t = railTheme({ color: '#06100E', textColor: null, accentColor: null })!;
    expect(t.vars['--nav-ring']).toBe('#25D366');
    expect(
      railTheme({ color: null, textColor: null, accentColor: '#5B3D8A' })!.vars['--nav-ring'],
    ).toBe('#5B3D8A');
  });
});

describe('greeting (WD-ASHELL-016)', () => {
  it('follows the hour: midnight oil, morning, afternoon, evening, night', () => {
    expect([0, 4, 5, 9, 12, 16, 17, 20, 21, 23].map(greetingKey)).toEqual([
      'midnightOil',
      'midnightOil',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
      'night',
    ]);
  });
  it('uses the first word of the name', () => {
    expect(firstName('Priya Nair')).toBe('Priya');
    expect(firstName('  Madonna ')).toBe('Madonna');
    expect(firstName('')).toBe('');
  });
});

describe('quick access (WD-ASHELL-022)', () => {
  it('shows the ten defaults to a person who never customised, and when the list is empty', () => {
    expect(resolveQuickAccess(null).map((t) => t.key)).toEqual([...QUICK_ACCESS_DEFAULT_KEYS]);
    expect(resolveQuickAccess([]).map((t) => t.key)).toEqual([...QUICK_ACCESS_DEFAULT_KEYS]);
  });
  it('keeps a pinned page and a custom link, marking only the link as custom', () => {
    const tiles = resolveQuickAccess([
      { key: 'webhooks' },
      { label: 'KB', url: 'https://example.com/kb' },
    ]);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toMatchObject({ key: 'webhooks', custom: false });
    expect(tiles[1]).toMatchObject({
      key: null,
      label: 'KB',
      url: 'https://example.com/kb',
      custom: true,
    });
  });
  it('drops javascript: links, protocol-relative links, blank labels and unknown keys', () => {
    expect(
      sanitizeQuickAccess([
        { label: 'x', url: 'javascript:alert(1)' },
        { label: 'evil', url: '//evil.example' },
        { label: 'evil2', url: '/\\evil.example' },
        { label: '   ', url: '/ok' },
        { key: 'nope' },
        { label: 'Reports', url: '/reports' },
      ]),
    ).toEqual([{ label: 'Reports', url: '/reports' }]);
    expect(isSafeShortcutUrl('HTTPS://example.com')).toBe(true);
    expect(isSafeShortcutUrl('mailto:a@b.c')).toBe(false);
  });
  it('cuts the label to 40 and the address to 255 characters, and keeps ten at most', () => {
    const [e] = sanitizeQuickAccess([{ label: 'L'.repeat(60), url: `/${'a'.repeat(400)}` }]) as {
      label: string;
      url: string;
    }[];
    expect(e!.label).toHaveLength(40);
    expect(e!.url).toHaveLength(255);
    const many = Array.from({ length: 14 }, () => ({ key: 'inbox' }));
    expect(sanitizeQuickAccess(many)).toHaveLength(10);
  });
  it('treats a body that is not a list as empty', () => {
    expect(sanitizeQuickAccess('x')).toEqual([]);
    expect(sanitizeQuickAccess({ key: 'inbox' })).toEqual([]);
  });
});

const row = (uuid: string, tone: string, dismissible = true): AnnouncementRow => ({
  uuid,
  text: `text ${uuid}`,
  link_url: null,
  link_label: null,
  tone,
  dismissible,
});

describe('announcement bars (WD-ASHELL-026)', () => {
  it('renders one bar per tone, in the order the tones first appear', () => {
    const bars = groupAnnouncements([row('a', 'info'), row('b', 'warning'), row('c', 'info')]);
    expect(bars.map((b) => b.tone)).toEqual(['info', 'warning']);
    expect(bars[0]!.items.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('changes the dismissal token when a member joins the group, so the bar returns', () => {
    const before = groupAnnouncements([row('a', 'info')])[0]!.token;
    const after = groupAnnouncements([row('a', 'info'), row('b', 'info')])[0]!.token;
    expect(after).not.toBe(before);
  });
  it('offers a dismiss button when any item allows it', () => {
    expect(
      groupAnnouncements([row('a', 'info', false), row('b', 'info', true)])[0]!.dismissible,
    ).toBe(true);
    expect(groupAnnouncements([row('a', 'info', false)])[0]!.dismissible).toBe(false);
  });
  it('scrolls for at least 20 seconds, longer for long text', () => {
    expect(marqueeSeconds([{ text: 'short', linkLabel: null }])).toBe(20);
    expect(marqueeSeconds([{ text: 'x'.repeat(500), linkLabel: null }])).toBe(100);
  });
});
