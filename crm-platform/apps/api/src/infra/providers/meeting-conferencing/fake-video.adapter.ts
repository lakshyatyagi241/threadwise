import type { ConnectedVideoProvider } from '@crm/contracts';
import { ConferencingError, type ConferencingFailureKind } from './conferencing.errors';
import type {
  VideoAccount,
  VideoMeetingRequest,
  VideoMeetingResult,
  VideoMeetingUpdate,
  VideoProviderAdapter,
  VideoTokens,
} from './video-provider.port';

export interface FakeVideoCall {
  op: 'authorizeUrl' | 'exchangeCode' | 'refresh' | 'profile' | 'create' | 'update' | 'delete';
  accessToken?: string;
  providerMeetingId?: string;
  request?: VideoMeetingRequest;
}

/**
 * An in-memory video provider for tests and for a development stack with no Zoom or Microsoft account (`CONFERENCING_FAKE=1`). It keeps the
 * rooms it made, records every call, and can be told to fail the next call(s) with any failure kind, so the soft-failure paths (a
 * provider that is down, a revoked grant, a meeting somebody deleted on the provider's side) are exercised without a network.
 *
 * Codes and tokens are readable on purpose: a code `ana@example.com` exchanges for an account of that address; a token is
 * `fake-access-<n>` and a refresh token `fake-refresh-<n>`. The join links it makes (`https://<provider>.fake.test/j/<id>`) do not open a call.
 * Nothing about it proves how the real Zoom or Microsoft Graph behave.
 */
export class FakeVideoProvider implements VideoProviderAdapter {
  readonly calls: FakeVideoCall[] = [];
  readonly rooms = new Map<string, { request: VideoMeetingRequest; joinUrl: string }>();
  /** The accounts the fake knows, by the access token it issued. */
  private readonly accounts = new Map<string, VideoAccount>();
  private readonly failures: Array<{
    op: FakeVideoCall['op'] | '*';
    kind: ConferencingFailureKind;
  }> = [];
  private sequence = 0;
  /** Set false to make a provider the platform has not set up (nobody can connect). */
  isConfigured = true;
  /** Tokens the fake treats as expired (the next call with one is a 401, as Zoom and Graph answer a stale token). */
  readonly expiredTokens = new Set<string>();

  constructor(readonly provider: ConnectedVideoProvider) {}

  /** The next call of `op` (or of any op, `*`) throws a failure of this kind. */
  failNext(kind: ConferencingFailureKind, op: FakeVideoCall['op'] | '*' = '*'): void {
    this.failures.push({ op, kind });
  }

  private maybeFail(op: FakeVideoCall['op']): void {
    const i = this.failures.findIndex((f) => f.op === op || f.op === '*');
    if (i === -1) return;
    const [f] = this.failures.splice(i, 1);
    throw new ConferencingError(f!.kind, f!.kind === 'rate_limit' ? 429 : 500, `fake_${f!.kind}`);
  }

  private checkToken(accessToken: string): void {
    if (this.expiredTokens.has(accessToken))
      throw new ConferencingError('auth', 401, 'fake_expired');
  }

  async configured(): Promise<boolean> {
    return this.isConfigured;
  }

  async authorizeUrl(state: string): Promise<string> {
    this.calls.push({ op: 'authorizeUrl' });
    if (!this.isConfigured) throw new ConferencingError('invalid_client', 0, 'not_configured');
    return `https://${this.provider}.fake.test/authorize?state=${encodeURIComponent(state)}`;
  }

  private issue(email: string | null): VideoTokens {
    this.sequence += 1;
    const accessToken = `fake-access-${this.sequence}`;
    this.accounts.set(accessToken, {
      id: `${this.provider}-acct-${email ?? this.sequence}`,
      email,
    });
    return {
      accessToken,
      refreshToken: `fake-refresh-${this.sequence}:${email ?? ''}`,
      expiresInSeconds: 3600,
      scope:
        this.provider === 'teams'
          ? 'OnlineMeetings.ReadWrite User.Read offline_access'
          : 'meeting:write',
    };
  }

  async exchangeCode(code: string): Promise<VideoTokens> {
    this.calls.push({ op: 'exchangeCode' });
    this.maybeFail('exchangeCode');
    if (code === 'bad-code')
      throw new ConferencingError('invalid_grant', 400, 'fake_invalid_grant');
    return this.issue(code.includes('@') ? code : null);
  }

  async refresh(refreshToken: string): Promise<VideoTokens> {
    this.calls.push({ op: 'refresh' });
    this.maybeFail('refresh');
    if (refreshToken.startsWith('revoked')) {
      throw new ConferencingError('invalid_grant', 400, 'fake_invalid_grant');
    }
    return this.issue(refreshToken.split(':')[1] || null);
  }

  async profile(accessToken: string): Promise<VideoAccount> {
    this.calls.push({ op: 'profile', accessToken });
    this.maybeFail('profile');
    this.checkToken(accessToken);
    return this.accounts.get(accessToken) ?? { id: null, email: null };
  }

  async createMeeting(accessToken: string, req: VideoMeetingRequest): Promise<VideoMeetingResult> {
    this.calls.push({ op: 'create', accessToken, request: req });
    this.maybeFail('create');
    this.checkToken(accessToken);
    // Like Teams' createOrGet: a repeat with the same key returns the room it already made. (Zoom would make a second one; the
    // service never repeats a create for Zoom, which is what this difference is for.)
    if (this.provider === 'teams') {
      for (const [id, room] of this.rooms) {
        if (room.request.meetingKey === req.meetingKey) {
          return { providerMeetingId: id, joinUrl: room.joinUrl };
        }
      }
    }
    this.sequence += 1;
    const id = `${this.provider}-room-${this.sequence}`;
    const joinUrl = `https://${this.provider}.fake.test/j/${id}`;
    this.rooms.set(id, { request: req, joinUrl });
    return { providerMeetingId: id, joinUrl };
  }

  async updateMeeting(
    accessToken: string,
    providerMeetingId: string,
    req: VideoMeetingRequest,
  ): Promise<VideoMeetingUpdate> {
    this.calls.push({ op: 'update', accessToken, providerMeetingId, request: req });
    this.maybeFail('update');
    this.checkToken(accessToken);
    const room = this.rooms.get(providerMeetingId);
    if (!room) throw new ConferencingError('not_found', 404, 'fake_not_found');
    room.request = req;
    return { providerMeetingId, joinUrl: this.provider === 'teams' ? room.joinUrl : null };
  }

  async deleteMeeting(accessToken: string, providerMeetingId: string): Promise<void> {
    this.calls.push({ op: 'delete', accessToken, providerMeetingId });
    this.maybeFail('delete');
    this.checkToken(accessToken);
    this.rooms.delete(providerMeetingId);
  }
}
