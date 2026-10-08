import { describe, expect, it } from 'vitest';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { IMPERSONATION_KEY } from '../api/impersonation';
import { ImpersonationBanner } from './impersonation-banner';

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000 - 5_000).toISOString();
const active = (over: Record<string, unknown> = {}) => ({
  active: true,
  sessionId: '6a9f0c52-1b6e-4a35-8f6d-3d2f7a0b9c11',
  operatorName: 'Root Operator',
  reason: 'Ticket 1234 debug',
  readOnly: false,
  expiresAt: soon(45),
  ...over,
});
const seeded = (data: unknown, locale: 'en' | 'ar' = 'en') =>
  renderAccount(<ImpersonationBanner />, { locale, seed: [[IMPERSONATION_KEY, data]] });

describe('impersonation banner (WD-WSP-033)', () => {
  it('names the workspace and the owner, shows the reason and the time left, and offers Stop', () => {
    const html = seeded(active());
    expect(html).toContain('data-testid="impersonation-banner"');
    expect(html).toContain('Viewing Acme Co as Asha Rao');
    expect(html).toContain('Ticket 1234 debug');
    expect(html).toMatch(/45 minutes left|44 minutes left/);
    expect(html).toContain('Stop impersonating');
    expect(html).not.toContain('impersonation-read-only');
  });

  it('is non-dismissible: there is no close control, only Stop', () => {
    const html = seeded(active());
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toMatch(/aria-label="(Close|Dismiss)/i);
  });

  it('shows the read-only badge for a read-only session', () => {
    const html = seeded(active({ readOnly: true }));
    expect(html).toContain('data-read-only="true"');
    expect(html).toContain('impersonation-read-only');
    expect(html).toContain('Read-only');
  });

  it('says so when less than a minute is left', () => {
    expect(seeded(active({ expiresAt: new Date(Date.now() + 20_000).toISOString() }))).toContain(
      'Less than a minute left',
    );
    expect(seeded(active({ expiresAt: soon(1) }))).toMatch(/1 minute left|Less than a minute/);
  });

  it('renders nothing for an ordinary session', () => {
    const html = seeded({
      active: false,
      sessionId: null,
      operatorName: null,
      reason: null,
      readOnly: false,
      expiresAt: null,
    });
    expect(html).not.toContain('impersonation-banner');
  });

  it('renders in Arabic too (falls back to English text for keys not yet translated)', () => {
    expect(seeded(active(), 'ar')).toContain('data-testid="impersonation-banner"');
  });
});
