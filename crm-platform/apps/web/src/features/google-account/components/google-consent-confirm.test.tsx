import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type GoogleConsentRequest } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  search: '',
  consent: { data: undefined as unknown, isPending: false, isError: false, error: null as unknown },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('../api/google-account', () => ({
  googleConsentApi: { confirm: vi.fn(), cancel: vi.fn() },
  useGoogleConsent: () => state.consent,
}));

import { GoogleConsentConfirm } from './google-consent-confirm';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'google-account.json'), 'utf8'),
) as Record<string, unknown>;
const html = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <GoogleConsentConfirm />
    </NextIntlClientProvider>,
  );

const ID = '0b8e6c1e-5f4e-4d57-9f0a-3a6a2d7f9c11';
const request = (over: Partial<GoogleConsentRequest> = {}): GoogleConsentRequest => ({
  id: ID,
  googleEmail: 'ana@example.com',
  workspaceName: 'Acme Clinic',
  requested: ['sheets', 'forms'],
  granted: ['sheets', 'forms'],
  missing: [],
  replacesAccount: null,
  expiresAt: '2027-01-01T00:10:00.000Z',
  returnTo: '/google-account',
  ...over,
});

beforeEach(() => {
  state.search = `?request=${ID}`;
  state.consent = { data: undefined, isPending: false, isError: false, error: null };
});

describe('the Google connection confirmation page', () => {
  it('asks "Connect <google email> to <workspace> for <permissions>?" with Confirm and Cancel', () => {
    state.consent.data = request();
    const out = html();
    expect(out).toContain('Connect ana@example.com to Acme Clinic for Sheets and Forms?');
    expect(out).toContain('>Confirm<');
    expect(out).toContain('>Cancel<');
    expect(out).toMatch(/do not confirm it/);
  });

  it('says what Google did not give and which account this replaces', () => {
    state.consent.data = request({
      granted: ['sheets'],
      missing: ['forms'],
      replacesAccount: 'old@example.com',
    });
    const out = html();
    expect(out).toContain('Google did not give: Forms');
    expect(out).toContain('replaces the Google account old@example.com');
  });

  it('refuses a link that was started by someone else, without offering to connect', () => {
    state.consent = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(403, ERROR_CODES.GOOGLE_CONSENT_NOT_YOURS, 'x'),
    };
    const out = html();
    expect(out).toContain('started by someone else');
    expect(out).toContain('Nothing was connected.');
    expect(out).not.toContain('>Confirm<');
  });

  it('explains an expired or used link in its own words', () => {
    state.consent = {
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError(410, ERROR_CODES.GOOGLE_CONSENT_EXPIRED, 'x'),
    };
    expect(html()).toContain('took too long to confirm');
    state.consent.error = new ApiError(409, ERROR_CODES.GOOGLE_CONSENT_USED, 'x');
    expect(html()).toContain('already confirmed, cancelled or refused');
  });

  it('shows nothing to confirm when the address has no valid request', () => {
    state.search = '?request=nope';
    const out = html();
    expect(out).toContain('not waiting for confirmation');
    expect(out).not.toContain('>Confirm<');
  });
});
