import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_MEDIA_LIMITS,
  SCHEDULE_MEDIA_MAX_BYTES,
  scheduleMediaProblem,
  scheduleMediaProblemText,
} from '@crm/contracts';

const MB = 1024 * 1024;

describe('what each channel accepts as a scheduled file (TW-SCHED-006)', () => {
  it('holds the Cloud API to 5 MB for an image and 16 MB for video and audio', () => {
    expect(scheduleMediaProblem('waba', { kind: 'image', mime: 'image/png', size: 5 * MB })).toBeNull();
    expect(scheduleMediaProblem('waba', { kind: 'image', mime: 'image/png', size: 5 * MB + 1 })).toEqual({
      code: 'too_large',
      engine: 'waba',
      kind: 'image',
      limitBytes: 5 * MB,
    });
    expect(scheduleMediaProblem('waba', { kind: 'video', mime: 'video/mp4', size: 16 * MB })).toBeNull();
    expect(scheduleMediaProblem('waba', { kind: 'audio', mime: 'audio/ogg', size: 17 * MB })).toMatchObject({
      code: 'too_large',
    });
  });

  it('takes only the formats Meta lists for an image, a video and audio, and any document', () => {
    expect(scheduleMediaProblem('waba', { kind: 'image', mime: 'image/webp', size: 10 })).toMatchObject({
      code: 'type_not_supported',
      mime: 'image/webp',
    });
    expect(scheduleMediaProblem('waba', { kind: 'video', mime: 'video/quicktime', size: 10 })).toMatchObject({
      code: 'type_not_supported',
    });
    expect(scheduleMediaProblem('waba', { kind: 'document', mime: 'application/pdf', size: 10 })).toBeNull();
    // the other engines send what WhatsApp itself opens
    expect(scheduleMediaProblem('baileys', { kind: 'image', mime: 'image/webp', size: 10 })).toBeNull();
    expect(scheduleMediaProblem('twilio', { kind: 'image', mime: 'image/webp', size: 10 })).toBeNull();
  });

  it('holds Twilio to 16 MB for everything, and the upload itself to 20 MB', () => {
    expect(scheduleMediaProblem('twilio', { kind: 'document', mime: 'application/pdf', size: 17 * MB })).toMatchObject({
      code: 'too_large',
      limitBytes: 16 * MB,
    });
    expect(SCHEDULE_MEDIA_MAX_BYTES).toBe(20 * MB);
    for (const limits of Object.values(SCHEDULE_MEDIA_LIMITS)) {
      for (const v of Object.values(limits)) expect(v).toBeLessThanOrEqual(SCHEDULE_MEDIA_MAX_BYTES);
    }
  });

  it('says what to do about it, in English, for the API; the screen words its own from the code', () => {
    expect(
      scheduleMediaProblemText({ code: 'too_large', engine: 'waba', kind: 'image', limitBytes: 5 * MB }),
    ).toBe('This image is bigger than WhatsApp Cloud API accepts (5 MB). Choose a smaller file.');
    expect(
      scheduleMediaProblemText({
        code: 'type_not_supported',
        engine: 'waba',
        kind: 'image',
        mime: 'image/webp',
      }),
    ).toContain('image/jpeg, image/png');
  });
});
