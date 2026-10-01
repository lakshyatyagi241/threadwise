import { Injectable } from '@nestjs/common';
import type { SocialCredentials, SocialOAuthProvider, SocialProfile } from './social-oauth.port';

const TIMEOUT_MS = 15_000;

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} responded ${res.status}`);
  return (await res.json()) as T;
}

@Injectable()
export class GoogleOAuthAdapter implements SocialOAuthProvider {
  readonly name = 'google' as const;

  authorizeUrl(credentials: SocialCredentials, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async fetchProfile(
    credentials: SocialCredentials,
    redirectUri: string,
    code: string,
  ): Promise<SocialProfile> {
    const token = await json<{ access_token?: string }>(
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      'google token',
    );
    if (!token.access_token) throw new Error('google token response had no access_token');

    const info = await json<{
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      given_name?: string;
      picture?: string;
    }>(
      await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      'google userinfo',
    );
    if (!info.sub) throw new Error('google userinfo had no sub');

    return {
      subject: info.sub,
      email: info.email?.toLowerCase() ?? null,
      emailVerified: info.email_verified === true,
      name: info.name ?? info.given_name ?? null,
      avatarUrl: info.picture ?? null,
    };
  }
}

@Injectable()
export class FacebookOAuthAdapter implements SocialOAuthProvider {
  readonly name = 'facebook' as const;
  private readonly version = 'v19.0';

  authorizeUrl(credentials: SocialCredentials, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email,public_profile',
      state,
    });
    return `https://www.facebook.com/${this.version}/dialog/oauth?${params.toString()}`;
  }

  async fetchProfile(
    credentials: SocialCredentials,
    redirectUri: string,
    code: string,
  ): Promise<SocialProfile> {
    const tokenUrl = new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();
    const token = await json<{ access_token?: string }>(
      await fetch(tokenUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
      'facebook token',
    );
    if (!token.access_token) throw new Error('facebook token response had no access_token');

    const meUrl = new URL(`https://graph.facebook.com/${this.version}/me`);
    meUrl.search = new URLSearchParams({
      fields: 'id,name,email,picture.width(256).height(256)',
      access_token: token.access_token,
    }).toString();
    const me = await json<{
      id?: string;
      name?: string;
      email?: string;
      picture?: { data?: { url?: string } };
    }>(await fetch(meUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) }), 'facebook me');
    if (!me.id) throw new Error('facebook profile had no id');

    return {
      subject: me.id,
      email: me.email?.toLowerCase() ?? null,
      // Facebook does not assert verification, so this never auto-links.
      emailVerified: false,
      name: me.name ?? null,
      avatarUrl: me.picture?.data?.url ?? null,
    };
  }
}
