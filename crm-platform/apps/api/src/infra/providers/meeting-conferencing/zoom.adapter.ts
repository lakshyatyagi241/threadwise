import { Injectable } from '@nestjs/common';
import { meetingConferencingEnv } from '../../../config/domains/meeting-conferencing.env';
import {
  classifyZoomApiError,
  classifyZoomTokenError,
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

/** Zoom wants minutes; an end before the start (or none that makes sense) is a half hour, the length a meeting has when no end is typed. */
export function zoomDurationMinutes(startsAt: Date, endsAt: Date): number {
  const minutes = Math.ceil((endsAt.getTime() - startsAt.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 30;
  return Math.min(minutes, 1440);
}

/** Zoom's `start_time` is `yyyy-MM-ddTHH:mm:ssZ`: UTC, no milliseconds. */
export const zoomStartTime = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Zoom's OAuth (authorization code) and its meetings REST API v2, one method per call (BL-360). Plain HTTP with a timeout; the platform's
 * OAuth app comes from `credentials` (the operator's, never a workspace's).
 *
 * Endpoints and parameters were taken from developers.zoom.us (OAuth 2.0 authorization code flow; Meetings API: create, update, delete a
 * meeting) and are NOT verified against a live Zoom account in this repository.
 */
@Injectable()
export class ZoomAdapter implements VideoProviderAdapter {
  readonly provider = 'zoom' as const;

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

  private api(path: string): string {
    return `${meetingConferencingEnv().ZOOM_API_URL.replace(/\/$/, '')}${path}`;
  }

  async authorizeUrl(state: string): Promise<string> {
    const c = await this.creds();
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      state,
    });
    return `${meetingConferencingEnv().ZOOM_OAUTH_AUTH_URL}?${q.toString()}`;
  }

  async exchangeCode(code: string): Promise<VideoTokens> {
    const c = await this.creds();
    // A code is good once: a repeat after a lost answer would fail with invalid_grant and hide the real outcome.
    return this.token(
      c,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: c.redirectUri,
      }),
      0,
    );
  }

  async refresh(refreshToken: string): Promise<VideoTokens> {
    const c = await this.creds();
    return this.token(
      c,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
  }

  private async token(
    c: ProviderCredentials,
    form: URLSearchParams,
    retries?: number,
  ): Promise<VideoTokens> {
    const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
    const body = (await conferencingRequest(meetingConferencingEnv().ZOOM_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      classify: classifyZoomTokenError,
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
    const me = (await conferencingRequest(this.api('/users/me'), {
      token: accessToken,
      classify: classifyZoomApiError,
      fetchImpl: this.fetchImpl,
    })) as Json;
    return { id: str(me.id), email: str(me.email)?.toLowerCase() ?? null };
  }

  private bodyOf(req: VideoMeetingRequest): Json {
    return {
      topic: req.topic,
      type: 2, // a scheduled meeting
      start_time: zoomStartTime(req.startsAt),
      duration: zoomDurationMinutes(req.startsAt, req.endsAt),
      timezone: req.timezone,
    };
  }

  async createMeeting(accessToken: string, req: VideoMeetingRequest): Promise<VideoMeetingResult> {
    const made = (await conferencingRequest(this.api('/users/me/meetings'), {
      method: 'POST',
      token: accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.bodyOf(req)),
      classify: classifyZoomApiError,
      // Zoom has no idempotency key: a repeat after a lost answer would make a second meeting.
      retries: 0,
      fetchImpl: this.fetchImpl,
    })) as Json;
    const id = made.id === undefined || made.id === null ? null : String(made.id);
    const joinUrl = str(made.join_url);
    if (!id || !joinUrl) throw new ConferencingError('bad_request', 201, 'no_join_url');
    return { providerMeetingId: id, joinUrl };
  }

  async updateMeeting(
    accessToken: string,
    providerMeetingId: string,
    req: VideoMeetingRequest,
  ): Promise<VideoMeetingUpdate> {
    // PATCH answers 204 with no body; the join address of a Zoom meeting does not change when it is moved.
    await conferencingRequest(this.api(`/meetings/${enc(providerMeetingId)}`), {
      method: 'PATCH',
      token: accessToken,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.bodyOf(req)),
      classify: classifyZoomApiError,
      fetchImpl: this.fetchImpl,
    });
    return { providerMeetingId, joinUrl: null };
  }

  async deleteMeeting(accessToken: string, providerMeetingId: string): Promise<void> {
    try {
      await conferencingRequest(this.api(`/meetings/${enc(providerMeetingId)}`), {
        method: 'DELETE',
        token: accessToken,
        classify: classifyZoomApiError,
        fetchImpl: this.fetchImpl,
      });
    } catch (err) {
      if (err instanceof ConferencingError && err.kind === 'not_found') return;
      throw err;
    }
  }
}
