import { describe, expect, it } from 'vitest';
import {
  planConferencing,
  releaseAll,
  validZone,
  type ConferencingState,
} from '../../../src/modules/crm/contact-meetings/meeting-conferencing.rules';

const START = new Date('2027-02-01T10:00:00Z');

const held = (over: Partial<ConferencingState> = {}): ConferencingState => ({
  hostUserId: 7,
  videoProvider: 'zoom',
  videoMeetingId: 'z-1',
  videoVia: 'app',
  addToCalendar: false,
  sendInvitation: false,
  calendarProvider: null,
  calendarId: null,
  calendarEventId: null,
  timeZone: 'Asia/Kolkata',
  ...over,
});

const facts = { actorUserId: 9, startsAt: START as Date | null, timeZone: 'Europe/Paris' };

describe('planConferencing', () => {
  it('a meeting that asks for nothing leaves no row and nothing to provision', () => {
    const r = planConferencing(null, undefined, facts);
    expect(r).toMatchObject({ ok: true, plan: { next: null, release: null, provision: false } });
  });

  it('a new Zoom request makes a pending row hosted by the person asking', () => {
    const r = planConferencing(null, { videoProvider: 'zoom' }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.next).toMatchObject({
      hostUserId: 9,
      videoProvider: 'zoom',
      resetVideo: true,
      addToCalendar: false,
      timeZone: 'Europe/Paris',
    });
    expect(r.plan.provision).toBe(true);
    expect(r.plan.release).toBeNull();
  });

  it('Meet forces the calendar entry on, and an invitation needs the calendar', () => {
    const r = planConferencing(null, { videoProvider: 'meet', sendInvitation: true }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.next).toMatchObject({ addToCalendar: true, sendInvitation: true });
    const none = planConferencing(null, { sendInvitation: true }, facts);
    if (!none.ok) throw new Error('refused');
    // An invitation on its own asks for nothing: no row.
    expect(none.plan.next).toBeNull();
  });

  it('refuses a link or a calendar entry for a meeting with no start time', () => {
    expect(planConferencing(null, { videoProvider: 'zoom' }, { ...facts, startsAt: null })).toEqual(
      { ok: false, problem: 'needs_start_time' },
    );
    expect(planConferencing(null, { addToCalendar: true }, { ...facts, startsAt: null })).toEqual({
      ok: false,
      problem: 'needs_start_time',
    });
  });

  it('an edit that says nothing about video keeps the request and the host, and asks for a move', () => {
    const r = planConferencing(held(), undefined, { actorUserId: 9, startsAt: START });
    if (!r.ok) throw new Error('refused');
    expect(r.plan.next).toMatchObject({
      hostUserId: 7,
      videoProvider: 'zoom',
      videoMeetingId: 'z-1',
      resetVideo: false,
      timeZone: 'Asia/Kolkata',
    });
    expect(r.plan.provision).toBe(true);
    expect(r.plan.release).toBeNull();
    expect(r.plan.clearJoinUrl).toBe(false);
  });

  it('changing the provider releases the old room, clears the link and makes the person the host', () => {
    const r = planConferencing(held(), { videoProvider: 'teams' }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.release).toEqual({
      hostUserId: 7,
      video: { provider: 'zoom', id: 'z-1' },
      calendar: null,
    });
    expect(r.plan.next).toMatchObject({
      hostUserId: 9,
      videoProvider: 'teams',
      videoMeetingId: null,
      videoVia: null,
      resetVideo: true,
    });
    expect(r.plan.clearJoinUrl).toBe(true);
  });

  it('removing the link releases the room and keeps the row quiet', () => {
    const r = planConferencing(held(), { videoProvider: null }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.release?.video).toEqual({ provider: 'zoom', id: 'z-1' });
    expect(r.plan.next).toMatchObject({ videoProvider: null, videoMeetingId: null });
    expect(r.plan.provision).toBe(false);
    expect(r.plan.clearJoinUrl).toBe(true);
  });

  it('taking the meeting off the calendar releases its event', () => {
    const cur = held({
      videoProvider: null,
      videoMeetingId: null,
      videoVia: null,
      addToCalendar: true,
      calendarProvider: 'google',
      calendarId: 'primary',
      calendarEventId: 'ev-1',
    });
    const r = planConferencing(cur, { addToCalendar: false }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.release).toEqual({
      hostUserId: 7,
      video: null,
      calendar: { provider: 'google', calendarId: 'primary', eventId: 'ev-1' },
    });
    expect(r.plan.next).toMatchObject({
      addToCalendar: false,
      calendarEventId: null,
      resetCalendar: true,
    });
  });

  it('a Meet room is part of its calendar event: moving away from Meet removes and remakes the event', () => {
    const cur = held({
      videoProvider: 'meet',
      videoMeetingId: null,
      videoVia: 'calendar',
      addToCalendar: true,
      calendarProvider: 'google',
      calendarId: 'primary',
      calendarEventId: 'ev-2',
    });
    const r = planConferencing(cur, { videoProvider: 'zoom' }, facts);
    if (!r.ok) throw new Error('refused');
    expect(r.plan.release?.calendar).toEqual({
      provider: 'google',
      calendarId: 'primary',
      eventId: 'ev-2',
    });
    expect(r.plan.next).toMatchObject({
      videoProvider: 'zoom',
      addToCalendar: true,
      calendarEventId: null,
      resetCalendar: true,
    });
  });

  it('an unknown time zone is not trusted', () => {
    expect(validZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(validZone('Mars/Olympus')).toBeNull();
    expect(validZone('')).toBeNull();
    const r = planConferencing(
      null,
      { videoProvider: 'zoom', timeZone: 'nope' },
      {
        ...facts,
        timeZone: 'nope',
      },
    );
    if (!r.ok) throw new Error('refused');
    expect(r.plan.next?.timeZone).toBeNull();
  });
});

describe('releaseAll', () => {
  it('captures everything a deleted meeting holds, and nothing when it holds nothing', () => {
    expect(releaseAll(null)).toBeNull();
    expect(releaseAll(held({ videoMeetingId: null }))).toBeNull();
    expect(
      releaseAll(
        held({ calendarProvider: 'microsoft', calendarId: null, calendarEventId: 'ev-9' }),
      ),
    ).toEqual({
      hostUserId: 7,
      video: { provider: 'zoom', id: 'z-1' },
      calendar: { provider: 'microsoft', calendarId: null, eventId: 'ev-9' },
    });
  });

  it('a room that lives inside the calendar event is removed with the event, not on its own', () => {
    const r = releaseAll(
      held({
        videoProvider: 'meet',
        videoMeetingId: null,
        videoVia: 'calendar',
        calendarProvider: 'google',
        calendarEventId: 'ev-3',
      }),
    );
    expect(r?.video).toBeNull();
    expect(r?.calendar?.eventId).toBe('ev-3');
  });
});
