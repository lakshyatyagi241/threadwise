import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FacebookOAuthAdapter,
  GoogleOAuthAdapter,
} from '../../../src/infra/providers/auth-registration-security/social-oauth.adapters';

const creds = { clientId: 'cid', clientSecret: 'csecret' };
const redirectUri = 'https://app.example.test/auth/social/google/callback';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('GoogleOAuthAdapter', () => {
  it('builds the consent URL with the state and the scopes it needs', () => {
    const url = new URL(new GoogleOAuthAdapter().authorizeUrl(creds, redirectUri, 'st4te'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'st4te',
    });
  });

  it('exchanges the code, reads the profile and lowercases the email', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return json({ access_token: 'at-1' });
      }
      return json({
        sub: 'g-123',
        email: 'Ana@Example.TEST',
        email_verified: true,
        name: 'Ana Rao',
        picture: 'https://img.example.test/a.png',
      });
    });

    const profile = await new GoogleOAuthAdapter().fetchProfile(creds, redirectUri, 'the-code');

    expect(profile).toEqual({
      subject: 'g-123',
      email: 'ana@example.test',
      emailVerified: true,
      name: 'Ana Rao',
      avatarUrl: 'https://img.example.test/a.png',
    });
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(Object.fromEntries(form)).toMatchObject({
      code: 'the-code',
      client_id: 'cid',
      client_secret: 'csecret',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    expect((calls[1]!.init!.headers as Record<string, string>).authorization).toBe('Bearer at-1');
  });

  it('does not trust an email Google did not verify', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('token')
        ? json({ access_token: 'at' })
        : json({ sub: 's', email: 'x@example.test', email_verified: false }),
    );
    const p = await new GoogleOAuthAdapter().fetchProfile(creds, redirectUri, 'c');
    expect(p.emailVerified).toBe(false);
  });

  it('fails clearly when Google rejects the code or returns no subject', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    await expect(new GoogleOAuthAdapter().fetchProfile(creds, redirectUri, 'c')).rejects.toThrow(
      /google token responded 400/,
    );
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ access_token: 'at' }))
      .mockResolvedValueOnce(json({ email: 'x@example.test' }));
    await expect(new GoogleOAuthAdapter().fetchProfile(creds, redirectUri, 'c')).rejects.toThrow(
      /no sub/,
    );
  });
});

describe('FacebookOAuthAdapter', () => {
  it('builds the dialog URL', () => {
    const url = new URL(
      new FacebookOAuthAdapter().authorizeUrl(creds, redirectUri.replace('google', 'facebook'), 's'),
    );
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('scope')).toBe('email,public_profile');
    expect(url.searchParams.get('state')).toBe('s');
  });

  it('never marks a Facebook email as verified, so it cannot auto-link', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(String(input));
      return String(input).includes('oauth/access_token')
        ? json({ access_token: 'fb-at' })
        : json({
            id: 'fb-9',
            name: 'Ben',
            email: 'Ben@Example.test',
            picture: { data: { url: 'https://img.example.test/b.png' } },
          });
    });
    const p = await new FacebookOAuthAdapter().fetchProfile(creds, redirectUri, 'code');
    expect(p).toEqual({
      subject: 'fb-9',
      email: 'ben@example.test',
      emailVerified: false,
      name: 'Ben',
      avatarUrl: 'https://img.example.test/b.png',
    });
    const token = new URL(urls[0]!);
    expect(token.searchParams.get('client_secret')).toBe('csecret');
    expect(new URL(urls[1]!).searchParams.get('access_token')).toBe('fb-at');
  });

  it('fails when the profile has no id', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ access_token: 'at' }))
      .mockResolvedValueOnce(json({ name: 'No Id' }));
    await expect(new FacebookOAuthAdapter().fetchProfile(creds, redirectUri, 'c')).rejects.toThrow(
      /no id/,
    );
  });
});
