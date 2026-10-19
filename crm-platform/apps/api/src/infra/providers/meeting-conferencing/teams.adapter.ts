import { Injectable } from '@nestjs/common';
import { microsoftCalendarEnv } from '../../../config/domains/microsoft-calendar.env';
import {
  classifyGraphError,
  classifyTeamsTokenError,
  ConferencingError,
} from './conferencing.errors';
import { conferencingRequest } from './conferencing-transport';
import type {
  ProviderCredentials,
  ProviderCredentialsSource,
  VideoAccount,
  VideoMeetingRequest,
  VideoMeetingResult,
  VideoMeetingUpdate,
  VideoProviderAdapter,
  VideoTokens,
} from './video-provider.port';

type Json = Record<string, unknown>;

const enc = encodeURIComponent;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `offline_access` gets the refresh token; `OnlineMeetings.ReadWrite` is the delegated permission that makes a meeting for the signed-in person. */
export const TEAMS_SCOPES = ['offline_access', 'User.Read', 'OnlineMeetings.ReadWrite'] as const;
export const TEAMS_REQUIRED_SCOPE = 'OnlineMeetings.ReadWrite';

/** A person (or an admin) can untick a permission on the consent screen: a grant without this one cannot make a meeting. */
export const teamsGrantCovers = (scopes: string | null | undefined): boolean =>
  (scopes ?? '').split(/\s+/).some((s) => s.toLowerCase() === TEAMS_REQUIRED_SCOPE.toLowerCase());

/**
 * Microsoft Teams meetings through the Microsoft identity platform (v2.0 authorization code flow) and Microsoft Graph's online meetings
 * (BL-360): `POST /me/onlineMeetings/createOrGet` (idempotent on an `externalId`, so a retry after a lost answer finds the same meeting),
 * `PATCH` and `DELETE /me/onlineMeetings/{id}`. A meeting is made for the signed-in person (delegated permission), so each person connects
 * their own Microsoft work or school account.
 *
 * Endpoints and parameters were taken from learn.microsoft.com (OAuth 2.0 authorization code flow; Graph: onlineMeeting createOrGet,
 * update, delete) and are NOT verified against a live Microsoft tenant in this repository. Whether the delete is available to every tenant
 * is unverified: a refusal is reported to the caller as `not_found`/`forbidden`/`bad_request` and handled there.
 */
@Injectable()
export class TeamsAdapter implements VideoProviderAdapter {
  readonly provider = 'teams' as const;

  constructor(
    private readonly source: ProviderCredentialsSource,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async configured(): Promise<boolean> {
    return (await this.source.credentials()) !== null;
  }

  private async creds(): Promise<ProviderCredentials> {
    const c = await this.source.credentials();
    if (!c) throw new ConferencingError('invalid_client', 0, 'not_configured');
    return c;
  }

  private authority(tenant: string | undefined): string {
    return `${microsoftCalendarEnv().MICROSOFT_CALENDAR_LOGIN_URL.replace(/\/$/, '')}/${enc(tenant || 'common')}/oauth2/v2.0`;
  }

  private graph(path: string): string {
    return `${microsoftCalendarEnv().MICROSOFT_CALENDAR_GRAPH_URL.replace(/\/$/, '')}${path}`;
  }

  async authorizeUrl(state: string): Promise<string> {
    const c = await this.creds();
    const q = new URLSearchParams({
      client_id: c.clientId,
      response_type: 'code',
      redirect_uri: c.redirectUri,
      response_mode: 'query',
      scope: TEAMS_SCOPES.join(' '),
      prompt: 'select_account',
      state,
    });
    return `${this.authority(c.tenant)}/authorize?${q.toString()}`;
  }

  async exchangeCode(code: string): Promise<VideoTokens> {
    const c = await this.creds();
    return this.token(
      c,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: c.redirectUri,
        scope: TEAMS_SCOPES.join(' '),
      }),
      0,
    );
  }

  async refresh(refreshToken: string): Promise<VideoTokens> {
    const c = await this.creds();
    return this.token(
      c,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: TEAMS_SCOPES.join(' '),
      }),
    );
  }

  private async token(
    c: ProviderCredentials,
    form: URLSearchParams,
    retries?: number,
  ): Promise<VideoTokens> {
    const body = (await conferencingRequest(`${this.authority(c.tenant)}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      classify: classifyTeamsTokenError,
      retries,
      fetchImpl: this.fetchImpl,
    })) as Json;
    const accessToken = str(body.access_token);
    if (!accessToken) throw new ConferencingError('bad_request', 200, 'no_access_token');
    const expires = Number(body.expires_in);
    return {
      accessToken,
      refreshToken: str(body.refresh_token),
      expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3600,
      scope: str(body.scope) ?? '',
    };
  }

  async profile(accessToken: string): Promise<VideoAccount> {
    const me = (await conferencingRequest(this.graph('/me?$select=id,mail,userPrincipalName'), {
      token: accessToken,
      classify: classifyGraphError,
      fetchImpl: this.fetchImpl,
    })) as Json;
    const address = str(me.mail) ?? str(me.userPrincipalName);
    return { id: str(me.id), email: address?.toLowerCase() ?? null };
  }

  private bodyOf(req: VideoMeetingRequest): Json {
    return {
      subject: req.topic,
      startDateTime: req.startsAt.toISOString(),
      endDateTime: req.endsAt.toISOString(),
    };
  }

  async createMeeting(accessToken: string, req: VideoMeetingRequest): Promise<VideoMeetingResult> {
    const made = (await conferencingRequest(this.graph('/me/onlineMeetings/createOrGet'), {
      method: 'POST',
      token: accessToken,
      headers: { 'content-type': 'application/json' },
      // `externalId` is what makes a repeat of this call return the meeting it already made.
      body: JSON.stringify({ ...this.bodyOf(req), externalId: req.meetingKey }),
      classify: classifyGraphError,
      fetchImpl: this.fetchImpl,
    })) as Json;
    const id = str(made.id);
    const joinUrl = str(made.joinWebUrl);
    if (!id || !joinUrl) throw new ConferencingError('bad_request', 201, 'no_join_url');
    return { providerMeetingId: id, joinUrl };
  }

  async updateMeeting(
    accessToken: string,
    providerMeetingId: string,
    req: VideoMeetingRequest,
  ): Promise<VideoMeetingUpdate> {
    const made = (await conferencingRequest(
      this.graph(`/me/onlineMeetings/${enc(providerMeetingId)}`),
      {
        method: 'PATCH',
        token: accessToken,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.bodyOf(req)),
        classify: classifyGraphError,
        fetchImpl: this.fetchImpl,
      },
    )) as Json;
    return { providerMeetingId, joinUrl: str(made.joinWebUrl) };
  }

  async deleteMeeting(accessToken: string, providerMeetingId: string): Promise<void> {
    try {
      await conferencingRequest(this.graph(`/me/onlineMeetings/${enc(providerMeetingId)}`), {
        method: 'DELETE',
        token: accessToken,
        classify: classifyGraphError,
        fetchImpl: this.fetchImpl,
      });
    } catch (err) {
      if (err instanceof ConferencingError && err.kind === 'not_found') return;
      throw err;
    }
  }
}

