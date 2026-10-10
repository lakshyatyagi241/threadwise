import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FacebookOAuthAdapter,
  GoogleOAuthAdapter,
} from '../../../src/infra/providers/auth-registration-security/social-oauth.adapters';
import { sha256Base64Url } from '../../../src/modules/auth/support/crypto-utils';

const clerk = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@clerk/backend', () => ({
  verifyToken: clerk.verifyToken,
  createClerkClient: () => ({ users: { getUser: clerk.getUser } }),
}));

import { ClerkService } from '../../../src/modules/auth/clerk.service';

afterEach(() => vi.restoreAllMocks());

describe('PKCE (RFC 7636, S256)', () => {
  it('derives the challenge exactly as the RFC example does', () => {
    expect(sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  const creds = { clientId: 'cid', clientSecret: 'secret' };
  const redirect = 'https://app.example.test/cb';

  it('Google sends the challenge on the consent URL and the verifier on the token call', async () => {
    const adapter = new GoogleOAuthAdapter();
    expect(adapter.pkce).toBe(true);
    const url = new URL(adapter.authorizeUrl(creds, redirect, 'st', 'CHALLENGE'));
    expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    let tokenBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/token')) {
        tokenBody = String((init?.body as URLSearchParams).toString());
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: 's', email: 'a@b.test', email_verified: true }), {
        status: 200,
      });
    });
    await adapter.fetchProfile(creds, redirect, 'code', 'VERIFIER');
    expect(new URLSearchParams(tokenBody).get('code_verifier')).toBe('VERIFIER');
  });

  it('omits both when no challenge is given, and Facebook never sends one', () => {
    const plain = new URL(new GoogleOAuthAdapter().authorizeUrl(creds, redirect, 'st'));
    expect(plain.searchParams.has('code_challenge')).toBe(false);
    const fb = new FacebookOAuthAdapter();
    expect(fb.pkce).toBe(false);
    expect(
      new URL(fb.authorizeUrl(creds, redirect, 'st', 'IGNORED')).searchParams.has('code_challenge'),
    ).toBe(false);
  });
});

describe('Clerk token exchange', () => {
  const service = (key = 'sk_live_realsecretvalue') =>
    new ClerkService({ get: () => key } as never);
  const user = (verification: { status: string } | null, extra = {}) => ({
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress: 'Ana@Acme.Test', verification }],
    firstName: 'Ana',
    lastName: 'Rao',
    ...extra,
  });

  it('treats the example placeholder and an empty key as "not configured"', () => {
    expect(service('sk_test_replace_me').isConfigured()).toBe(false);
    expect(service('').isConfigured()).toBe(false);
    expect(service('sk_live_realsecretvalue').isConfigured()).toBe(true);
  });

  it('accepts a verified primary address', async () => {
    clerk.verifyToken.mockResolvedValue({ sub: 'user_1' });
    clerk.getUser.mockResolvedValue(user({ status: 'verified' }));
    await expect(service().verifySession('t')).resolves.toMatchObject({
      clerkUserId: 'user_1',
      email: 'ana@acme.test',
      fullName: 'Ana Rao',
    });
  });

  it.each([{ status: 'unverified' }, { status: 'expired' }, null])(
    "refuses an address Clerk has not verified (%o): it could be someone else registering the victim's email",
    async (verification) => {
      clerk.verifyToken.mockResolvedValue({ sub: 'user_1' });
      clerk.getUser.mockResolvedValue(user(verification as never));
      await expect(service().verifySession('t')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    },
  );

  it('refuses a token Clerk rejects and an account with no address', async () => {
    clerk.verifyToken.mockRejectedValue(new Error('bad'));
    await expect(service().verifySession('t')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    clerk.verifyToken.mockResolvedValue({ sub: 'user_1' });
    clerk.getUser.mockResolvedValue(
      user(null, { emailAddresses: [], primaryEmailAddressId: null }),
    );
    await expect(service().verifySession('t')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
