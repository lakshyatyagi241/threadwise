import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/profile',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));
vi.mock('@/components/shell/actions', () => ({
  setLocale: async () => undefined,
  setTheme: async () => undefined,
}));

const { ProfileView } = await import('./profile-view');

const profile = (over = {}) => ({
  fullName: 'Asha Rao',
  displayName: null,
  email: 'asha@acme.test',
  emailVerified: true,
  pendingEmail: null,
  phone: null,
  locale: null,
  timezone: null,
  effectiveTimezone: 'Asia/Kolkata',
  theme: 'paper',
  avatarUrl: null,
  avatarMaxBytes: 1048576,
  workspaceTimezone: 'Asia/Kolkata',
  canEditWorkspaceTimezone: true,
  ...over,
});
const render = (over = {}, locale: 'en' | 'ar' = 'en') =>
  renderAccount(createElement(ProfileView), { locale, seed: [[keys.profile, profile(over)]] });

describe('ProfileView', () => {
  it('lays the fields out like Reference: name pair, email, then phone beside the timezone', () => {
    const html = render();
    const at = ['Full name', 'Display name', '>Email<', '>Phone<', 'Timezone'].map((label) =>
      html.indexOf(label),
    );
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('fills the display name with the first name as its value when none is saved', () => {
    expect(render()).toMatch(/<input[^>]*value="Asha"/);
    expect(render({ displayName: 'Ash' })).toMatch(/<input[^>]*value="Ash"/);
  });

  it('no longer offers the paper/bright/dark theme picker (it moved to the profile dropdown)', () => {
    const html = render();
    expect(html).not.toContain('>Theme<');
    expect(html).not.toContain('>Paper<');
    expect(html).not.toContain('>Bright<');
  });

  it('shows the workspace timezone to everyone, tagged and naming the workspace', () => {
    const html = render({ canEditWorkspaceTimezone: false });
    expect(html).toContain('(workspace)');
    expect(html).toContain('Applies to Acme Co. Only owners and administrators can change it.');
    expect(html).toContain('Asia/Kolkata');
  });

  it('lets the owner change it and locks it for a member', () => {
    const owner = render({ canEditWorkspaceTimezone: true });
    const member = render({ canEditWorkspaceTimezone: false });
    // The timezone box is the input whose id ends in "-tz".
    const tz = (html: string) => /<input[^>]*id="[^"]*-tz"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tz(owner)).toContain('role="combobox"');
    expect(tz(owner)).not.toContain(' disabled=""');
    expect(tz(member)).toContain(' disabled=""');
  });

  it('keeps Reset and Save changes live', () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>(Reset|Save changes)/);
    expect(html).toContain('Save changes');
  });

  it('keeps the email read-only with the change flow behind a button', () => {
    const html = render({ pendingEmail: 'new@acme.test' });
    expect(html).toContain('Change email');
    expect(html).toContain('new@acme.test');
    expect(html).toContain('Verified');
  });

  it('renders in Arabic', () => {
    expect(render({}, 'ar')).toContain('المنطقة الزمنية');
  });
});
