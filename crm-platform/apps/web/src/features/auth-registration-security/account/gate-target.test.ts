import type { AccountFlags, Landing } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { GATE_ROUTES, pathOf } from '../shared/gate-routes';
import { landingPath } from '../shared/landing';
import { gatePageRedirect, gateTarget } from './gate-target';

const NONE: AccountFlags = {
  suspended: false,
  emailUnverified: false,
  emailBlocked: false,
  mfaEnrolmentRequired: false,
  passwordChangeRequired: false,
};
const flags = (over: Partial<AccountFlags>): AccountFlags => ({ ...NONE, ...over });

const KEYS = [
  'suspended',
  'emailUnverified',
  'emailBlocked',
  'mfaEnrolmentRequired',
  'passwordChangeRequired',
] as const;
const COMBINATIONS: AccountFlags[] = Array.from({ length: 1 << KEYS.length }, (_, mask) => {
  const f = { ...NONE };
  KEYS.forEach((k, i) => {
    f[k] = Boolean(mask & (1 << i));
  });
  return f;
});
const LANDINGS: Landing[] = ['dashboard', 'inbox', 'onboarding'];
const APP_PATHS = [
  '/dashboard',
  '/contacts',
  '/inbox',
  '/account',
  '/account/profile',
  '/account/branding',
  '/account/security',
  '/account/delete',
];
const GATE_PAGES = [
  ['/suspended', 'suspended'],
  ['/verify-email-required', 'verifyEmail'],
  ['/onboarding', 'onboarding'],
] as const;

describe('gateTarget', () => {
  it('lets a clean account through everywhere', () => {
    for (const p of APP_PATHS)
      expect(gateTarget({ pathname: p, flags: NONE, landing: 'dashboard' })).toBeNull();
  });

  it('sends a suspended account to /suspended and keeps it there', () => {
    const f = flags({ suspended: true, emailBlocked: true, passwordChangeRequired: true });
    expect(gateTarget({ pathname: '/dashboard', flags: f, landing: 'dashboard' })).toBe(
      '/suspended',
    );
    expect(gateTarget({ pathname: '/account/security', flags: f, landing: 'dashboard' })).toBe(
      '/suspended',
    );
    expect(gateTarget({ pathname: '/suspended', flags: f, landing: 'dashboard' })).toBeNull();
  });

  it('forces the password screen, exempting the whole security section', () => {
    const f = flags({ passwordChangeRequired: true });
    expect(gateTarget({ pathname: '/contacts', flags: f, landing: 'dashboard' })).toBe(
      '/account/security?required=password',
    );
    expect(gateTarget({ pathname: '/account/profile', flags: f, landing: 'dashboard' })).toBe(
      '/account/security?required=password',
    );
    expect(
      gateTarget({ pathname: '/account/security', flags: f, landing: 'dashboard' }),
    ).toBeNull();
  });

  it('forces MFA enrolment onto the security screen, which is exempt', () => {
    const f = flags({ mfaEnrolmentRequired: true });
    expect(gateTarget({ pathname: '/dashboard', flags: f, landing: 'dashboard' })).toBe(
      '/account/security?required=mfa',
    );
    expect(
      gateTarget({ pathname: '/account/security', flags: f, landing: 'dashboard' }),
    ).toBeNull();
  });

  it('puts the password gate ahead of MFA, and both ahead of the email gate', () => {
    const both = flags({
      passwordChangeRequired: true,
      mfaEnrolmentRequired: true,
      emailBlocked: true,
    });
    expect(gateTarget({ pathname: '/dashboard', flags: both, landing: 'dashboard' })).toBe(
      '/account/security?required=password',
    );
    const mfaAndMail = flags({ mfaEnrolmentRequired: true, emailBlocked: true });
    expect(gateTarget({ pathname: '/dashboard', flags: mfaAndMail, landing: 'dashboard' })).toBe(
      '/account/security?required=mfa',
    );
  });

  it('blocks an unverified account except on its screen and first-run setup', () => {
    const f = flags({ emailUnverified: true, emailBlocked: true });
    expect(gateTarget({ pathname: '/dashboard', flags: f, landing: 'dashboard' })).toBe(
      '/verify-email-required',
    );
    expect(gateTarget({ pathname: '/account/profile', flags: f, landing: 'dashboard' })).toBe(
      '/verify-email-required',
    );
    expect(
      gateTarget({ pathname: '/verify-email-required', flags: f, landing: 'dashboard' }),
    ).toBeNull();
    expect(gateTarget({ pathname: '/onboarding', flags: f, landing: 'onboarding' })).toBeNull();
  });

  it('does not gate an unverified account under the banner policy', () => {
    const f = flags({ emailUnverified: true });
    expect(gateTarget({ pathname: '/dashboard', flags: f, landing: 'dashboard' })).toBeNull();
  });

  it('sends an administrator with unfinished setup to onboarding but leaves /account reachable', () => {
    expect(gateTarget({ pathname: '/dashboard', flags: NONE, landing: 'onboarding' })).toBe(
      '/onboarding',
    );
    expect(gateTarget({ pathname: '/onboarding', flags: NONE, landing: 'onboarding' })).toBeNull();
    expect(
      gateTarget({ pathname: '/account/profile', flags: NONE, landing: 'onboarding' }),
    ).toBeNull();
  });

  it('never gates on onboarding for someone who cannot finish it', () => {
    expect(gateTarget({ pathname: '/dashboard', flags: NONE, landing: 'inbox' })).toBeNull();
  });
});

describe('every redirect destination is exempt (no loops)', () => {
  it('a destination never redirects again to itself or elsewhere', () => {
    for (const f of COMBINATIONS) {
      for (const landing of LANDINGS) {
        for (const p of [...APP_PATHS, '/suspended', '/verify-email-required', '/onboarding']) {
          const target = gateTarget({ pathname: p, flags: f, landing });
          if (!target) continue;
          const again = gateTarget({ pathname: pathOf(target), flags: f, landing });
          expect(again, `${p} -> ${target} (${JSON.stringify(f)}, ${landing})`).toBeNull();
        }
      }
    }
  });

  it('following redirects always settles within a few hops', () => {
    const settle = (start: string, f: AccountFlags, landing: Landing) => {
      let at = start;
      for (let hop = 0; hop < 8; hop++) {
        let next: string | null;
        const page = GATE_PAGES.find(([path]) => path === at);
        if (at === GATE_ROUTES.home) next = landingPath(landing, f);
        else if (page) next = gatePageRedirect(page[1], { flags: f, landing });
        else next = gateTarget({ pathname: at, flags: f, landing });
        if (!next) return at;
        at = pathOf(next);
      }
      return null;
    };
    for (const f of COMBINATIONS) {
      for (const landing of LANDINGS) {
        for (const start of [...APP_PATHS, ...GATE_PAGES.map(([p]) => p), '/']) {
          expect(
            settle(start, f, landing),
            `${start} (${JSON.stringify(f)}, ${landing})`,
          ).not.toBeNull();
        }
      }
    }
  });
});

describe('gatePageRedirect', () => {
  it('keeps a suspended person on /suspended and sends anyone else home', () => {
    expect(
      gatePageRedirect('suspended', { flags: flags({ suspended: true }), landing: 'dashboard' }),
    ).toBeNull();
    expect(gatePageRedirect('suspended', { flags: NONE, landing: 'dashboard' })).toBe('/');
  });

  it('keeps a blocked account on the verify page and lets a verified one leave', () => {
    const blocked = flags({ emailUnverified: true, emailBlocked: true });
    expect(gatePageRedirect('verifyEmail', { flags: blocked, landing: 'dashboard' })).toBeNull();
    expect(gatePageRedirect('verifyEmail', { flags: NONE, landing: 'dashboard' })).toBe('/');
  });

  it('defers to a higher-priority gate', () => {
    const f = flags({ emailBlocked: true, passwordChangeRequired: true });
    expect(gatePageRedirect('verifyEmail', { flags: f, landing: 'dashboard' })).toBe(
      '/account/security?required=password',
    );
    expect(
      gatePageRedirect('onboarding', { flags: flags({ suspended: true }), landing: 'onboarding' }),
    ).toBe('/suspended');
  });

  it('shows onboarding only to someone whose landing is onboarding', () => {
    expect(gatePageRedirect('onboarding', { flags: NONE, landing: 'onboarding' })).toBeNull();
    expect(gatePageRedirect('onboarding', { flags: NONE, landing: 'dashboard' })).toBe('/');
  });
});
