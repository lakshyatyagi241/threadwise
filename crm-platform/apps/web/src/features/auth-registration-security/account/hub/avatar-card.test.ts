import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { makeSession, renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/profile',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { AvatarCard } = await import('./avatar-card');

const withUser = (over: object) => {
  const base = makeSession();
  return makeSession({ user: { ...base.user, ...over } });
};

describe('AvatarCard', () => {
  it('always draws the initials as the base, so the circle is never blank', () => {
    const html = renderAccount(createElement(AvatarCard), {
      session: withUser({ avatarUrl: '/api/v2/account/avatar?v=abc' }),
    });
    expect(html).toContain('<span aria-hidden="true">AR</span>');
    expect(html).toMatch(/<img[^>]*src="\/api\/v2\/account\/avatar\?v=abc"/);
    expect(html).toContain('Remove photo');
  });

  it('without a photo: initials only, nothing to remove', () => {
    const html = renderAccount(createElement(AvatarCard));
    expect(html).toContain('>AR<');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Remove photo');
  });

  it('takes the initials from the display name when there is one', () => {
    const html = renderAccount(createElement(AvatarCard), {
      session: withUser({ displayName: 'Nova Star' }),
    });
    expect(html).toContain('>NS<');
  });

  it('states the accepted types and the size the server really keeps', () => {
    const html = renderAccount(createElement(AvatarCard), {
      seed: [[keys.profile, { avatarMaxBytes: 2 * 1024 * 1024 }]],
    });
    expect(html).toContain('accept="image/jpeg,image/png,image/webp,image/gif"');
    expect(html).toContain('JPG, PNG, WebP or GIF. We shrink it to fit 2 MB.');
  });

  it('says 1 MB until the server has reported its limit', () => {
    expect(renderAccount(createElement(AvatarCard))).toContain('fit 1 MB.');
  });
});
