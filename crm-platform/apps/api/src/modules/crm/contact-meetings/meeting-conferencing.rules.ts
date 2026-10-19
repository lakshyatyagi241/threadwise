import type { MeetingConferencingInput, VideoProvider, VideoVia } from '@crm/contracts';

/**
 * The pure rules of a meeting's video link and calendar entry (BL-361, BL-362): what the row should say after a request, and which
 * provider-side things the change leaves behind that must be removed. No database, no clock, no provider: the service loads the facts and
 * applies the plan; the provisioning side (module meeting-conferencing) makes the plan real.
 */

/** The row as it stands (null = the meeting has none). */
export interface ConferencingState {
  hostUserId: number | null;
  videoProvider: VideoProvider | null;
  videoMeetingId: string | null;
  videoVia: VideoVia | null;
  addToCalendar: boolean;
  sendInvitation: boolean;
  calendarProvider: 'google' | 'microsoft' | null;
  calendarId: string | null;
  calendarEventId: string | null;
  timeZone: string | null;
}

/** What the provisioning side removes at the provider. Captured BEFORE the row is changed, so it survives a delete. */
export interface ReleaseSnapshot {
  hostUserId: number | null;
  video: { provider: 'zoom' | 'teams'; id: string } | null;
  calendar: { provider: 'google' | 'microsoft'; calendarId: string | null; eventId: string } | null;
}

export interface ConferencingPlan {
  /** The row after the change (null = nothing is asked for and there is no row to keep). */
  next: {
    hostUserId: number | null;
    videoProvider: VideoProvider | null;
    /** Cleared when the old room is released. */
    videoMeetingId: string | null;
    videoVia: VideoVia | null;
    /** `pending` whenever a provider is asked for and no room exists yet (or the old one was released). */
    resetVideo: boolean;
    addToCalendar: boolean;
    sendInvitation: boolean;
    /** Cleared when the old event is released. */
    calendarProvider: 'google' | 'microsoft' | null;
    calendarId: string | null;
    calendarEventId: string | null;
    resetCalendar: boolean;
    timeZone: string | null;
  } | null;
  /** The old room/event to remove at the provider (null = nothing). */
  release: ReleaseSnapshot | null;
  /** The join address is no longer valid and is cleared from the meeting. */
  clearJoinUrl: boolean;
  /** Something is asked for: the provisioning side runs after the save. */
  provision: boolean;
}

export type PlanProblem = 'needs_start_time';

export type PlanResult = { ok: true; plan: ConferencingPlan } | { ok: false; problem: PlanProblem };

/** An IANA zone name the runtime knows; anything else is not trusted (the browser's zone is untrusted input). */
export function validZone(zone: string | undefined | null): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export const hasHeld = (s: ConferencingState | null): boolean =>
  !!s && (s.videoMeetingId !== null || s.calendarEventId !== null);

/** The snapshot of everything the row holds at a provider: for a delete, where the row goes with the meeting. */
export function releaseAll(s: ConferencingState | null): ReleaseSnapshot | null {
  if (!s) return null;
  const video =
    s.videoVia === 'app' &&
    s.videoMeetingId &&
    (s.videoProvider === 'zoom' || s.videoProvider === 'teams')
      ? { provider: s.videoProvider, id: s.videoMeetingId }
      : null;
  const calendar =
    s.calendarEventId && s.calendarProvider
      ? { provider: s.calendarProvider, calendarId: s.calendarId, eventId: s.calendarEventId }
      : null;
  return video || calendar ? { hostUserId: s.hostUserId, video, calendar } : null;
}

/**
 * Works out the row after `request`. `request` undefined = the form sent nothing about video or calendar (an edit of the title or the time):
 * the row keeps asking for what it asked for, and the provisioning side moves the room and the event with the meeting.
 * `startsAt` is the meeting's start AFTER this change; a link or a calendar entry needs one.
 */
export function planConferencing(
  current: ConferencingState | null,
  request: MeetingConferencingInput | undefined,
  facts: { actorUserId: number | null; startsAt: Date | null; timeZone?: string | null },
): PlanResult {
  const cur = current;
  const provider: VideoProvider | null =
    request?.videoProvider === undefined ? (cur?.videoProvider ?? null) : request.videoProvider;
  let calendar = request?.addToCalendar ?? cur?.addToCalendar ?? false;
  // A Meet room is part of a Google Calendar event.
  if (provider === 'meet') calendar = true;
  const invite = calendar ? (request?.sendInvitation ?? cur?.sendInvitation ?? false) : false;

  if ((provider !== null || calendar) && facts.startsAt === null) {
    // Only a request that ASKS for something is refused; an old row whose meeting lost its time keeps what it holds and is left alone.
    if (request && (request.videoProvider || request.addToCalendar)) {
      return { ok: false, problem: 'needs_start_time' };
    }
  }

  const providerChanged = (cur?.videoProvider ?? null) !== provider;
  const calendarOff = !calendar;
  // Which parts of what the row holds the change leaves behind.
  let dropVideo = false;
  let dropCalendar = false;
  if (cur && providerChanged) {
    if (cur.videoVia === 'app' && cur.videoMeetingId) dropVideo = true;
    // The room was part of the calendar event: the event is removed and made again without it.
    if (cur.videoVia === 'calendar' && cur.calendarEventId) dropCalendar = true;
  }
  if (cur && calendarOff && cur.calendarEventId) dropCalendar = true;

  const release: ReleaseSnapshot | null =
    cur && (dropVideo || dropCalendar)
      ? {
          hostUserId: cur.hostUserId,
          video:
            dropVideo &&
            cur.videoMeetingId &&
            (cur.videoProvider === 'zoom' || cur.videoProvider === 'teams')
              ? { provider: cur.videoProvider, id: cur.videoMeetingId }
              : null,
          calendar:
            dropCalendar && cur.calendarEventId && cur.calendarProvider
              ? {
                  provider: cur.calendarProvider,
                  calendarId: cur.calendarId,
                  eventId: cur.calendarEventId,
                }
              : null,
        }
      : null;

  const nothingAsked = provider === null && !calendar;
  // The row stays (with nothing asked) while something is held that the release still has to remove; with nothing held it goes quiet.
  const next =
    nothingAsked && !cur
      ? null
      : {
          // Whoever sets or changes the provider hosts the room: it is made in THEIR account. Other edits leave the host alone.
          hostUserId:
            providerChanged && provider !== null
              ? facts.actorUserId
              : (cur?.hostUserId ?? facts.actorUserId),
          videoProvider: provider,
          videoMeetingId: providerChanged || dropVideo ? null : (cur?.videoMeetingId ?? null),
          videoVia: providerChanged ? null : (cur?.videoVia ?? null),
          resetVideo: providerChanged && provider !== null,
          addToCalendar: calendar,
          sendInvitation: invite,
          calendarProvider: dropCalendar || calendarOff ? null : (cur?.calendarProvider ?? null),
          calendarId: dropCalendar || calendarOff ? null : (cur?.calendarId ?? null),
          calendarEventId: dropCalendar || calendarOff ? null : (cur?.calendarEventId ?? null),
          resetCalendar: dropCalendar || calendarOff,
          timeZone: validZone(facts.timeZone) ?? cur?.timeZone ?? null,
        };

  return {
    ok: true,
    plan: {
      next,
      release,
      clearJoinUrl: !!cur?.videoProvider && providerChanged,
      provision: !nothingAsked && facts.startsAt !== null,
    },
  };
}
