import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../api';
import { makeSession, renderAccount } from '../render-test-utils';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/security',
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
}));

const { MfaPanel } = await import('./mfa-panel');

const off = { enabled: false, confirmedAt: null, recoveryCodesRemaining: 0, required: false };
const on = {
  enabled: true,
  confirmedAt: '2026-09-01T10:00:00.000Z',
  recoveryCodesRemaining: 1,
  required: false,
};
const setup = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/Acme:asha@acme.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  expiresInSeconds: 600,
};
const render = (seed: Parameters<typeof renderAccount>[1], forcedByUrl = false) =>
  renderAccount(createElement(MfaPanel, { forcedByUrl }), seed);

describe('MfaPanel while two-factor is off', () => {
  const html = render({
    seed: [
      [keys.mfa, off],
      [keys.mfaSetup, setup],
    ],
  });

  it('opens with the QR code and the setup key on screen, no button to press first', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('Scan this QR code');
    expect(html).toContain('JBSW Y3DP EHPK 3PXP');
    expect(html).not.toContain('Set up authenticator app');
  });

  it('asks for the six-digit code with a numeric one-time-code box and a Turn on button', () => {
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('Turn on');
  });

  it('has no cancel: there is nothing to dismiss', () => {
    expect(html).not.toContain('>Cancel<');
  });

  it('says it is preparing while the setup key has not arrived yet', () => {
    const waiting = render({ seed: [[keys.mfa, off]] });
    expect(waiting).toContain('Preparing your setup');
    expect(waiting).not.toContain('<svg viewBox="0 0 29');
  });

  it('puts the forced-enrolment notice on top when the organization requires it', () => {
    const forced = render(
      {
        seed: [
          [keys.mfa, off],
          [keys.mfaSetup, setup],
        ],
      },
      true,
    );
    expect(forced).toContain('Your organization requires two-factor authentication');
    const gated = renderAccount(createElement(MfaPanel, { forcedByUrl: false }), {
      seed: [
        [keys.mfa, off],
        [keys.mfaSetup, setup],
      ],
      session: makeSession({
        flags: {
          suspended: false,
          emailUnverified: false,
          emailBlocked: false,
          mfaEnrolmentRequired: true,
          passwordChangeRequired: false,
        },
      }),
    });
    expect(gated).toContain('Your organization requires two-factor authentication');
  });
});

describe('MfaPanel while two-factor is on', () => {
  it('shows the state, when it began, the recovery codes left and the two actions', () => {
    const html = render({ seed: [[keys.mfa, on]] });
    expect(html).toContain('>On<');
    expect(html).toContain('Since Sep 1, 2026');
    expect(html).toContain('1 recovery code left.');
    expect(html).toContain('Generate new ones soon.');
    expect(html).toContain('Replace recovery codes');
    expect(html).toContain('Turn off');
    expect(html).not.toContain('Scan this QR code');
  });

  it('renders in Arabic', () => {
    expect(render({ locale: 'ar', seed: [[keys.mfa, on]] })).toContain('يتبقى رمز استرداد واحد');
  });
});
