import type { ConnectedVideoProvider } from '@crm/contracts';

/**
 * The port between a contact's meeting and the video provider that holds its room (Zoom, Microsoft Teams). The domain only ever talks to this
 * interface, so a provider is one adapter file, a test uses the fake, and a meeting is never lost because a provider is down.
 *
 * Google Meet is NOT behind this port: Google makes the room as part of a calendar event, so it goes through the calendar port
 * (`CalendarSyncPort`, `createMeet`), the same way an appointment's Meet link is made.
 *
 * An adapter holds no tenant, no database and no secret of its own: every credential and token is an argument. A failure throws a
 * `ConferencingError` whose `kind` the caller switches on.
 */

export const VIDEO_PROVIDER_ADAPTERS = Symbol('VIDEO_PROVIDER_ADAPTERS');
export type VideoProviderAdapters = Readonly<Record<ConnectedVideoProvider, VideoProviderAdapter>>;

/** The platform's OAuth app of one provider: where the consent screen and the token calls are made as. */
export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Microsoft only: `common`, `organizations`, `consumers` or a directory id. */
  tenant?: string;
}

/** Where an adapter gets the platform's OAuth app (the console's saved value, else the environment): null = not set up or switched off. */
export interface ProviderCredentialsSource {
  credentials(): Promise<ProviderCredentials | null>;
}

export interface VideoTokens {
  accessToken: string;
  /** Zoom and Microsoft both rotate it: a refresh returns a new one, which replaces the one in use. */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted, space separated. */
  scope: string;
}

export interface VideoAccount {
  /** The provider's stable id of the account. */
  id: string | null;
  /** Lower-cased. */
  email: string | null;
}

export interface VideoMeetingRequest {
  /** Our meeting's uuid: a stable key an adapter can use to make a repeat of the same create return the same room. */
  meetingKey: string;
  topic: string;
  startsAt: Date;
  endsAt: Date;
  /** IANA zone the times are shown in (Zoom wants one with the start time). */
  timezone: string;
}

export interface VideoMeetingResult {
  /** The provider's id of the room: what a later move or delete addresses. */
  providerMeetingId: string;
  /** The address that joins the call. */
  joinUrl: string;
}

export interface VideoMeetingUpdate {
  providerMeetingId: string;
  /** The address as the provider shows it now, or null when the provider did not say (it normally does not change). */
  joinUrl: string | null;
}

export interface VideoProviderAdapter {
  readonly provider: ConnectedVideoProvider;
  /** Whether the platform has this provider's OAuth app (so a person can connect at all). */
  configured(): Promise<boolean>;
  /** The consent address for a signed `state`. Throws `ConferencingError('invalid_client')` when the platform has no app. */
  authorizeUrl(state: string): Promise<string>;
  exchangeCode(code: string): Promise<VideoTokens>;
  refresh(refreshToken: string): Promise<VideoTokens>;
  profile(accessToken: string): Promise<VideoAccount>;
  createMeeting(accessToken: string, req: VideoMeetingRequest): Promise<VideoMeetingResult>;
  /** Moves or renames the room. A room that no longer exists throws a `not_found` error: the caller makes a new one. */
  updateMeeting(
    accessToken: string,
    providerMeetingId: string,
    req: VideoMeetingRequest,
  ): Promise<VideoMeetingUpdate>;
  /** Removes the room. A room that is already gone is success. */
  deleteMeeting(accessToken: string, providerMeetingId: string): Promise<void>;
}
