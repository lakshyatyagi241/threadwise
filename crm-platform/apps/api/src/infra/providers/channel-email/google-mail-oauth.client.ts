import { Injectable } from '@nestjs/common';
import { channelEmailEnv, GOOGLE_MAIL_SCOPES } from '../../../config/domains/channel-email.env';
import { googleSend } from './google-http';
import { classifyApiError, classifyTokenError, GoogleMailError } from './google-mail.errors';

/** The platform's OAuth client for mail: where the consent screen and the token calls are made as. */
export interface GoogleMailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleMailTokens {
  accessToken: string;
  /** Only on a code exchange, and only when Google issued one (it does with `access_type=offline` and `prompt=consent`). */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted (a person can untick some on the consent screen). */
  scope: string;
}

export interface GoogleAccount {
  sub: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Google's OAuth endpoints for the Email channel (TW-MAIL-020). Plain HTTP with a timeout; every credential and token is an argument and
 * every failure is a `GoogleMailError`. Endpoints and parameters were taken from developers.google.com (OAuth 2.0 for web server apps)
 * and are not verified against a live Google account in this repository.
 */
@Injectable()
export class GoogleMailOAuthClient {
  /** `access_type=offline` + `prompt=consent`: Google issues a refresh token on every consent, a reconnect included. */
  authorizeUrl(creds: GoogleMailCredentials, state: string, loginHint?: string): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: 'code',
      scope: GOOGLE_MAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    if (loginHint) q.set('login_hint', loginHint);
    return `${channelEmailEnv().GOOGLE_OAUTH_AUTH_URL}?${q.toString()}`;
  }

  async exchangeCode(creds: GoogleMailCredentials, code: string): Promise<GoogleMailTokens> {
    const body = await this.token({
      grant_type: 'authorization_code',
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
    });
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new GoogleMailError('server', 200, 'no_access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  /** Google does not rotate the refresh token: only a new access token comes back. */
  async refresh(creds: GoogleMailCredentials, refreshToken: string): Promise<GoogleMailTokens> {
    const body = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new GoogleMailError('server', 200, 'no_access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken: null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  /** Withdraws the grant at Google. An already-revoked token answers 400 `invalid_token`: that is as good as revoked. */
  async revoke(token: string): Promise<void> {
    const env = channelEmailEnv();
    try {
      await googleSend(env.GOOGLE_OAUTH_REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        timeoutMs: env.GOOGLE_MAIL_HTTP_TIMEOUT_MS,
        classify: classifyTokenError,
      });
    } catch (err) {
      if (err instanceof GoogleMailError && err.status === 400) return;
      throw err;
    }
  }

  async userinfo(accessToken: string): Promise<GoogleAccount> {
    const env = channelEmailEnv();
    const body = await googleSend(env.GOOGLE_USERINFO_URL, {
      token: accessToken,
      timeoutMs: env.GOOGLE_MAIL_HTTP_TIMEOUT_MS,
      classify: classifyApiError,
    });
    return {
      sub: typeof body.sub === 'string' ? body.sub : null,
      email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : null,
      emailVerified: body.email_verified === true || body.email_verified === 'true',
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null,
    };
  }

  private token(form: Record<string, string>): Promise<Record<string, unknown>> {
    const env = channelEmailEnv();
    return googleSend(env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      timeoutMs: env.GOOGLE_MAIL_HTTP_TIMEOUT_MS,
      classify: classifyTokenError,
    });
  }
}
