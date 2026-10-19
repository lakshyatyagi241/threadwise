import { describe, expect, it } from 'vitest';
import { emptyInlineMeeting, valuesOf } from './meeting-inline';
import { toCreateMeeting, toUpdateMeeting } from './meeting-time';

/** The video and calendar part of the meeting request (BL-360..BL-362): sent only when asked, with the viewer's zone. */
describe('the meeting request with a video link and a calendar entry', () => {
  const draft = (conferencing?: Parameters<typeof valuesOf>[0]['conferencing']) => ({
    ...emptyInlineMeeting(new Date('2027-02-01T08:00:00Z'), 'Asia/Kolkata'),
    title: 'Intro call',
    conferencing,
  });

  it('says nothing about video or calendar when nothing was asked, exactly as before', () => {
    const body = toCreateMeeting(valuesOf(draft()), 'Asia/Kolkata');
    expect(body).not.toHaveProperty('conferencing');
    expect(toUpdateMeeting(valuesOf(draft()), 3, 'Asia/Kolkata')).not.toHaveProperty('conferencing');
  });

  it('carries what was asked, with the zone the times were typed in', () => {
    const asked = { videoProvider: 'zoom' as const, addToCalendar: true, sendInvitation: true };
    expect(toCreateMeeting(valuesOf(draft(asked)), 'Asia/Kolkata').conferencing).toEqual({
      ...asked,
      timeZone: 'Asia/Kolkata',
    });
    expect(toUpdateMeeting(valuesOf(draft(asked)), 3, 'Asia/Kolkata')).toMatchObject({
      rowVersion: 3,
      conferencing: { videoProvider: 'zoom', timeZone: 'Asia/Kolkata' },
    });
  });

  it('sends the removal of a link explicitly', () => {
    expect(toUpdateMeeting(valuesOf(draft({ videoProvider: null })), 2).conferencing).toEqual({
      videoProvider: null,
    });
  });
});
