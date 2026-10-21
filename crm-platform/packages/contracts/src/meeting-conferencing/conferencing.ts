import { z } from 'zod';

/**
 * Video conferencing for a contact's meeting (BL-360..BL-369).
 *
 * `zoom` and `teams` are integrations from the Marketplace: the workspace installs the app, then each person connects their OWN account
 * (the meeting is hosted by the person who scheduled it). `meet` has no app of its own: Google makes the room when the meeting is put on
 * the workspace's connected Google Calendar, so it is offered only while that calendar is usable.
 */
export const VIDEO_PROVIDERS = ['zoom', 'teams', 'meet'] as const;
export const videoProviderSchema = z.enum(VIDEO_PROVIDERS);
export type VideoProvider = z.infer<typeof videoProviderSchema>;

/** The providers a person connects an account of (the others ride on the workspace calendar). */
export const CONNECTED_VIDEO_PROVIDERS = ['zoom', 'teams'] as const;
export const connectedVideoProviderSchema = z.enum(CONNECTED_VIDEO_PROVIDERS);
export type ConnectedVideoProvider = z.infer<typeof connectedVideoProviderSchema>;

/** The Marketplace listing (slug) that must be installed before a provider can be connected or offered. */
export const CONFERENCING_APP_SLUG: Readonly<Record<ConnectedVideoProvider, string>> = {
  zoom: 'zoom',
  teams: 'microsoft-teams',
};

export const conferencingCallbackPath = (provider: ConnectedVideoProvider): string =>
  `/v2/public/conferencing/${provider}/callback`;

/** The outcome the callback hands back to the connection page (`?video=confirm&ticket=...`). */
export const CONFERENCING_CONFIRM_OUTCOME = 'confirm';

/** Why a requested link or calendar entry is not there. Stored on the meeting; the web words it in the reader's language. */
export const CONFERENCING_PROBLEMS = [
  'not_installed',
  'not_connected',
  'needs_reconnect',
  'not_configured',
  'calendar_not_connected',
  'provider_failed',
  'no_start_time',
] as const;
export const conferencingProblemSchema = z.enum(CONFERENCING_PROBLEMS);
export type ConferencingProblem = z.infer<typeof conferencingProblemSchema>;

export const MEETING_CALENDAR_PROVIDERS = ['google', 'microsoft'] as const;
export const meetingCalendarProviderSchema = z.enum(MEETING_CALENDAR_PROVIDERS);
export type MeetingCalendarProvider = z.infer<typeof meetingCalendarProviderSchema>;

/** `app`: a Zoom or Teams account the person connected. `calendar`: the room is part of the calendar event (Meet; Teams made by the Microsoft 365 calendar). */
export const VIDEO_VIAS = ['app', 'calendar'] as const;
export const videoViaSchema = z.enum(VIDEO_VIAS);
export type VideoVia = z.infer<typeof videoViaSchema>;

/** What the Add meeting form may offer THIS person right now. Nothing here is a guess: each option is installed AND connected. */
export const conferencingCapabilitiesSchema = z.object({
  /** The video options to show, in a stable order (zoom, teams, meet). Empty: the form shows no video row at all. */
  video: z.array(z.object({ provider: videoProviderSchema, via: videoViaSchema })),
  /** The calendar a meeting can be put on (the workspace's connected one), or null. */
  calendar: z
    .object({
      provider: meetingCalendarProviderSchema,
      account: z.string().nullable(),
      calendarName: z.string().nullable(),
    })
    .nullable(),
  /** Whether the person may install integrations (Marketplace). Decides whether a quiet "Connect video conferencing" link is shown. */
  canInstall: z.boolean(),
  /** Installed by the workspace but not connected by this person: the link goes to their connection page. */
  connectable: z.array(connectedVideoProviderSchema),
  /**
   * At least one of the video integrations can be installed RIGHT NOW: its listing is published (visible to this workspace) and the
   * platform has the provider's OAuth app. A listing that is still a draft, or a provider the operator has not set up, is not installable,
   * so the quiet "Connect video conferencing" link is never a dead end.
   */
  installable: z.boolean(),
  /** Where that link goes: the listing page when exactly one integration is installable, the Integrations tab when several are, else null. */
  installPath: z.string().nullable(),
});
export type ConferencingCapabilities = z.infer<typeof conferencingCapabilitiesSchema>;

export const CONNECTION_STATUSES = [
  'connected',
  'needs_reconnect',
  'disconnected',
  'not_installed',
  'not_available',
  'unavailable',
] as const;
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** One card of Settings, Video meetings: the state of a provider for the signed-in person. */
export const conferencingConnectionSchema = z.object({
  provider: connectedVideoProviderSchema,
  /**
   * `not_available`: the workspace has not installed it and cannot yet (the listing is not published, or the platform has no OAuth app for
   * it): ask the platform operator, no install button. `not_installed`: it can be installed now. `disconnected`: installed, the person has
   * not connected. `unavailable`: installed, but the platform's OAuth app was switched off or removed since.
   */
  status: connectionStatusSchema,
  /** Published and visible to this workspace (a free listing is shown to every workspace once published). */
  listingPublished: z.boolean(),
  /** The platform has the provider's OAuth app (Zoom environment values; the Microsoft Calendar app or Teams values for Teams). */
  configured: z.boolean(),
  /** The listing page to install it from when it can be installed now (a deep link, never the empty list), else null. */
  listingPath: z.string().nullable(),
  account: z.string().nullable(),
  connectedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
});
export type ConferencingConnection = z.infer<typeof conferencingConnectionSchema>;

export const conferencingConnectionListSchema = z.object({
  data: z.array(conferencingConnectionSchema),
  canInstall: z.boolean(),
});
export type ConferencingConnectionList = z.infer<typeof conferencingConnectionListSchema>;

export const conferencingStartInputSchema = z.object({
  /** A path inside the app to return to; anything else falls back to the connection page. */
  returnTo: z.string().max(300).optional(),
});
export type ConferencingStartInput = z.infer<typeof conferencingStartInputSchema>;

export const conferencingStartResponseSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int(),
});
export type ConferencingStartResponse = z.infer<typeof conferencingStartResponseSchema>;

/** The provider's redirect back to us. `code` and `state` are the provider's; `error` is set when the person said no. */
export const conferencingCallbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(2048).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(500).optional(),
});
export type ConferencingCallbackQuery = z.infer<typeof conferencingCallbackQuerySchema>;

export const conferencingConfirmInputSchema = z.object({ ticket: z.string().min(10).max(4096) });
export type ConferencingConfirmInput = z.infer<typeof conferencingConfirmInputSchema>;

/**
 * What the Add meeting form sends with a meeting. Left out: nothing changes. `videoProvider: null` removes a link the meeting had.
 * `addToCalendar` puts the meeting on the workspace's connected calendar; `sendInvitation` also lets the calendar invite the contact (by
 * email), which only the calendar's own invitation does: our own email invitation to attendees is unchanged.
 */
export const meetingConferencingInputSchema = z
  .object({
    videoProvider: videoProviderSchema.nullable().optional(),
    addToCalendar: z.boolean().optional(),
    sendInvitation: z.boolean().optional(),
    /** The IANA zone the times were entered in (the browser's); calendar events and Zoom want one. Left out: UTC. */
    timeZone: z.string().min(1).max(64).optional(),
  })
  .strict();
export type MeetingConferencingInput = z.infer<typeof meetingConferencingInputSchema>;

export const VIDEO_STATUSES = ['pending', 'ready', 'failed'] as const;
export const videoStatusSchema = z.enum(VIDEO_STATUSES);
export const CALENDAR_ENTRY_STATUSES = ['synced', 'failed'] as const;
export const calendarEntryStatusSchema = z.enum(CALENDAR_ENTRY_STATUSES);

/** The conferencing state of a meeting, as the list and the timeline read it. */
export const meetingConferencingSchema = z.object({
  videoProvider: videoProviderSchema.nullable(),
  videoStatus: videoStatusSchema.nullable(),
  videoError: conferencingProblemSchema.nullable(),
  calendarProvider: meetingCalendarProviderSchema.nullable(),
  calendarStatus: calendarEntryStatusSchema.nullable(),
  calendarError: conferencingProblemSchema.nullable(),
  /** The calendar was asked to invite the contact. */
  invited: z.boolean(),
});
export type MeetingConferencing = z.infer<typeof meetingConferencingSchema>;

/**
 * The operator's read-only view of what each video provider still needs (Operator console, Marketplace listing page of Zoom and Microsoft
 * Teams). Nothing here is a secret: only whether a value is set, never the value.
 */
export const CONFERENCING_GAPS = [
  'client_id',
  'client_secret',
  'switched_off',
  'listing_missing',
  'listing_not_published',
] as const;
export const conferencingGapSchema = z.enum(CONFERENCING_GAPS);
export type ConferencingGap = z.infer<typeof conferencingGapSchema>;

export const conferencingOperatorProviderSchema = z.object({
  provider: connectedVideoProviderSchema,
  /** The Marketplace listing slug. */
  slug: z.string(),
  /** Where the OAuth app's values come from today: the environment, the console's Microsoft Calendar page, or nowhere. */
  credentialsSource: z.enum(['environment', 'console', 'none']),
  hasClientId: z.boolean(),
  hasClientSecret: z.boolean(),
  /** The operator switched the Microsoft Calendar integration off in the console (Teams only): Teams is off with it. */
  switchedOff: z.boolean(),
  /** The exact address to register as the redirect URI at the provider (built from APP_URL, or the override). */
  redirectUri: z.string(),
  listing: z.object({
    exists: z.boolean(),
    /** `draft`, `published`, `hidden`, `killed` ... as the catalogue calls it; null when the listing does not exist. */
    status: z.string().nullable(),
    published: z.boolean(),
  }),
  /** What is still missing, in the order to fix it. Empty = ready. */
  gaps: z.array(conferencingGapSchema),
  ready: z.boolean(),
});
export type ConferencingOperatorProvider = z.infer<typeof conferencingOperatorProviderSchema>;

export const conferencingOperatorStatusSchema = z.object({
  providers: z.array(conferencingOperatorProviderSchema),
  /** The in-memory fake adapters are bound (`CONFERENCING_FAKE=1`, development only): every provider answers as set up. */
  fakeAdapters: z.boolean(),
});
export type ConferencingOperatorStatus = z.infer<typeof conferencingOperatorStatusSchema>;
