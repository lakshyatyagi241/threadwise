import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { SmsPlatformPage } from './sms-platform-page';
import { SMS_PLATFORM_QUERY_KEY } from './queries';
import { SMS_OPERATOR_NAV } from './operator-nav';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/sms',
  useSearchParams: () => new URLSearchParams(),
}));

const page = (enabled: boolean, locale: 'en' | 'ar' = 'en', role?: 'super_admin' | 'admin') =>
  renderWithMessages(createElement(SmsPlatformPage), {
    locale,
    ...(role ? { role: role as never } : {}),
    seed: [[SMS_PLATFORM_QUERY_KEY, { enabled }]],
  });

const toggle = (html: string) => /data-testid="sms-platform-toggle"[^>]*>([^<]*)</.exec(html)?.[1];

describe('SMS platform switch page', () => {
  it('off: shows the disabled state and offers to enable it', () => {
    const html = page(false);
    expect(html).toContain('data-testid="sms-platform-card"');
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('SMS channel');
    expect(html).toContain('SMS is off.');
    expect(toggle(html)).toBe('Enable SMS');
  });

  it('on: shows the enabled state and offers to disable it', () => {
    const html = page(true);
    expect(html).toContain('data-state="enabled"');
    expect(html).toContain('SMS is on.');
    expect(toggle(html)).toBe('Disable SMS');
  });

  it('a super admin gets the control; another operator sees the state and a note, no control', () => {
    expect(page(false, 'en', 'super_admin')).toContain('sms-platform-toggle');
    const html = page(false, 'en', 'admin');
    expect(html).not.toContain('sms-platform-toggle');
    expect(html).toContain('Only a super admin can change the SMS switch.');
  });

  it('renders in Arabic with the translated words', () => {
    const html = page(false, 'ar');
    expect(html).toContain('قناة الرسائل النصية');
    expect(toggle(html)).toBe('تفعيل الرسائل النصية');
  });

  it('is one console menu entry pointing at /admin/sms', () => {
    expect(SMS_OPERATOR_NAV).toEqual([
      expect.objectContaining({ id: 'sms-channel', href: '/admin/sms' }),
    ]);
  });
});
