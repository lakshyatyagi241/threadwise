import { Injectable } from '@nestjs/common';
import { channelEmailEnv, MICROSOFT_MAIL_SCOPES } from '../../../config/domains/channel-email.env';
import { microsoftSend } from './microsoft-http';
import {
  classifyGraphError,
  classifyMicrosoftTokenError,
  MicrosoftMailError,
} from './microsoft-mail.errors';

/** The platform's Entra app for mail: where the consent screen and the token calls are made as. */
export interface MicrosoftMailCredentials {
  clientId: string;
  clientSecret: string;
  /** `common`, `organizations`, `consumers` or a directory id. */
  tenant: string;
  redirectUri: string;
}

export interface MicrosoftMailTokens {
  accessToken: string;
  /** Microsoft rotates it: a refresh returns a new one, and the one in use must be replaced by it. */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted, space separated (a person or an admin can narrow them). */
  scope: string;
}

export interface MicrosoftAccount {
  /** The directory object id: stable for the account. */
  id: string | null;
  /** `mail`, else the sign-in name. Lower-cased. */
  address: string | null;
  name: string | null;
}

const enc = encodeURIComponent;

/**
 * Microsoft identity platform (v2.0) OAuth endpoints for the Email channel (TW-MAIL-034), plus `/me`. Plain HTTP with a timeout; every
 * credential and token is an argument and every failure is a `MicrosoftMailError`. Endpoints and parameters were taken from
 * learn.microsoft.com (OAuth 2.0 authorization code flow, Microsoft Graph user resource) and are not verified against a live Microsoft
 * tenant in this repository.
 */
@Injectable()
export class MicrosoftMailOAuthClient {
  private authority(tenant: string): string {
    return `${channelEmailEnv().MICROSOFT_LOGIN_URL.replace(/\/$/, '')}/${enc(tenant || 'common')}/oauth2/v2.0`;
  }

  /** `offline_access` gets the refresh token; `select_account` lets a person with several sessions pick the mailbox (a reconnect names it). */
  authorizeUrl(creds: MicrosoftMailCredentials, state: string, loginHint?: string): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      response_type: 'code',
      redirect_uri: creds.redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_MAIL_SCOPES.join(' '),
      state,
    });
    if (loginHint) q.set('login_hint', loginHint);
    else q.set('prompt', 'select_account');
    return `${this.authority(creds.tenant)}/authorize?${q.toString()}`;
  }

  async exchangeCode(creds: MicrosoftMailCredentials, code: string): Promise<MicrosoftMailTokens> {
    return this.token(creds, {
      grant_type: 'authorization_code',
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
      scope: MICROSOFT_MAIL_SCOPES.join(' '),
    });
  }

  async refresh(
    creds: MicrosoftMailCredentials,
    refreshToken: string,
  ): Promise<MicrosoftMailTokens> {
    return this.token(creds, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: MICROSOFT_MAIL_SCOPES.join(' '),
    });
  }

  /** The account behind an access token. `mail` is empty on some personal accounts, whose sign-in name is then the address. */
  async me(accessToken: string): Promise<MicrosoftAccount> {
    const env = channelEmailEnv();
    const body = await microsoftSend(
      `${env.MICROSOFT_GRAPH_URL.replace(/\/$/, '')}/me?$select=id,displayName,mail,userPrincipalName`,
      {
        token: accessToken,
        timeoutMs: env.MICROSOFT_MAIL_HTTP_TIMEOUT_MS,
        classify: classifyGraphError,
      },
    );
    const mail = typeof body.mail === 'string' && body.mail.includes('@') ? body.mail : null;
    const upn =
      typeof body.userPrincipalName === 'string' && body.userPrincipalName.includes('@')
        ? body.userPrincipalName
        : null;
    const address = (mail ?? upn)?.trim().toLowerCase() ?? null;
    return {
      id: typeof body.id === 'string' && body.id ? body.id : null,
      address,
      name:
        typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim()
          : null,
    };
  }

  private async token(
    creds: MicrosoftMailCredentials,
    form: Record<string, string>,
  ): Promise<MicrosoftMailTokens> {
    const env = channelEmailEnv();
    const body = await microsoftSend(`${this.authority(creds.tenant)}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      timeoutMs: env.MICROSOFT_MAIL_HTTP_TIMEOUT_MS,
      classify: classifyMicrosoftTokenError,
    });
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new MicrosoftMailError('server', 200, 'no_access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }
}
