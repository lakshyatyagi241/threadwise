import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMessages } from '../render-test-utils';
import { ApiError } from '@/lib/api/errors';
import { ErrorBlock } from './state';
import { IpBlockedPage, IpBlockedView } from './ip-blocked-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
}));

describe('IpBlockedView', () => {
  it('shows the blocked address, where to fix it and the two ways out', () => {
    const html = renderWithMessages(createElement(IpBlockedView, { ip: '203.0.113.9' }));
    expect(html).toContain('203.0.113.9');
    expect(html).toContain('/admin/security#api');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('Go to dashboard');
    expect(html).toContain('Sign out');
  });

  it('says so when the server could not read the address', () => {
    const html = renderWithMessages(createElement(IpBlockedView, { ip: null }));
    expect(html).toContain('could not read your address');
    expect(html).not.toContain('<code');
  });

  it('has every message in Arabic too', () => {
    const html = renderWithMessages(createElement(IpBlockedView, { ip: '2001:db8::7' }), {
      locale: 'ar',
    });
    expect(html).toContain('2001:db8::7');
    expect(html).toContain('تسجيل الخروج');
  });
});

describe('ErrorBlock', () => {
  it('shows the blocked view, not a generic forbidden block, when the API refused the address', () => {
    const error = new ApiError(403, 'AUTH_IP_BLOCKED', 'Access is not allowed.', 'req-1', [
      { path: 'ip', message: '198.51.100.4' },
    ]);
    const html = renderWithMessages(createElement(ErrorBlock, { error }));
    expect(html).toContain('198.51.100.4');
    expect(html).toContain('Go to dashboard');
    expect(html).not.toContain('Your role does not allow this');
  });

  it('keeps the plain forbidden block for a role refusal', () => {
    const error = new ApiError(403, 'AUTH_OPERATOR_ROLE_REQUIRED', 'No.', 'req-2');
    const html = renderWithMessages(createElement(ErrorBlock, { error }));
    expect(html).toContain('Your role does not allow this');
    expect(html).not.toContain('Go to dashboard');
  });
});

describe('IpBlockedPage', () => {
  it('is the same view on a page of its own, with no console shell around it', () => {
    const html = renderWithMessages(createElement(IpBlockedPage, { ip: '203.0.113.9' }));
    expect(html).toContain('<main');
    expect(html).toContain('203.0.113.9');
    expect(html).toContain('Go to dashboard');
    expect(html).not.toContain('console-sidebar');
  });
});
