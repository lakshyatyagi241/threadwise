import { describe, expect, it } from 'vitest';
import {
  MAX_PHOTOS,
  SCHEDULE_TOO_FAR,
  SCHEDULE_TOO_SOON,
  checkSchedule,
  contentProblem,
  dayIn,
  keepPhotos,
  kpisFrom,
  lastDays,
  likePattern,
  postStats,
  postType,
  rangeSince,
  validTimeZone,
} from '../../../src/modules/channel-facebook/post-rules';

const NOW = new Date('2026-10-02T12:00:00Z');
const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe('the schedule window (TW-FB-016 rule 4)', () => {
  it('no time publishes now', () => {
    expect(checkSchedule(null, NOW)).toEqual({ ok: true, at: null, ts: null });
  });

  it('under 10 minutes ahead is too soon, over 75 days too far, the edges are allowed', () => {
    expect(checkSchedule(inMin(9), NOW)).toEqual({ ok: false, message: SCHEDULE_TOO_SOON });
    expect(checkSchedule(inMin(-5), NOW)).toEqual({ ok: false, message: SCHEDULE_TOO_SOON });
    const ten = checkSchedule(inMin(10), NOW);
    expect(ten).toMatchObject({ ok: true, ts: Math.floor(inMin(10).getTime() / 1000) });
    expect(checkSchedule(inMin(75 * 24 * 60), NOW).ok).toBe(true);
    expect(checkSchedule(inMin(75 * 24 * 60 + 1), NOW)).toEqual({
      ok: false,
      message: SCHEDULE_TOO_FAR,
    });
  });
});

describe('what a post is (TW-FB-016)', () => {
  const base = { photos: [], link: '', video: '', asReel: false };

  it('a video wins, then photos, then a link, else text', () => {
    expect(postType({ ...base, video: 'https://x/v.mp4' })).toBe('video');
    expect(postType({ ...base, video: 'https://x/v.mp4', asReel: true })).toBe('reel');
    expect(postType({ ...base, video: 'https://x/v.mp4', photos: ['a'], link: 'l' })).toBe('video');
    expect(postType({ ...base, photos: ['a'] })).toBe('photo');
    expect(postType({ ...base, photos: ['a', 'b'] })).toBe('multi_photo');
    expect(postType({ ...base, link: 'https://x' })).toBe('link');
    expect(postType(base)).toBe('text');
    expect(postType({ ...base, asReel: true })).toBe('text');
  });

  it('photos are trimmed, de-duplicated and capped at ten', () => {
    expect(keepPhotos([' a ', '', 'a', 'b'])).toEqual(['a', 'b']);
    const many = Array.from({ length: 15 }, (_, i) => `https://x/${i}.jpg`);
    expect(keepPhotos(many)).toHaveLength(MAX_PHOTOS);
    expect(keepPhotos(many)[0]).toBe('https://x/0.jpg');
  });

  it('a post needs something, and photos with a link are refused (Reference’s words)', () => {
    expect(contentProblem({ message: '', link: '', photos: [], video: '' })).toBe(
      'Write something, add a link, or attach a photo.',
    );
    expect(contentProblem({ message: 'hi', link: '', photos: [], video: '' })).toBeNull();
    expect(contentProblem({ message: '', link: 'https://x', photos: [], video: '' })).toBeNull();
    expect(contentProblem({ message: '', link: '', photos: ['a'], video: '' })).toBeNull();
    expect(contentProblem({ message: '', link: 'https://x', photos: ['a'], video: '' })).toBe(
      'A post can have photos or a link, not both. Remove one.',
    );
  });

  it('a video needs an HTTPS address and nothing else', () => {
    expect(contentProblem({ message: '', link: '', photos: [], video: 'http://x/v.mp4' })).toBe(
      'The video URL must be a public HTTPS link.',
    );
    expect(
      contentProblem({ message: '', link: '', photos: [], video: 'HTTPS://x/v.mp4' }),
    ).toBeNull();
  });
});

describe('the list filters (TW-FB-017)', () => {
  it('a range is days back from now; all is no bound', () => {
    expect(rangeSince('7d', NOW)?.toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(rangeSince('30d', NOW)?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
    expect(rangeSince('90d', NOW)?.toISOString()).toBe('2026-07-04T12:00:00.000Z');
    expect(rangeSince('all', NOW)).toBeNull();
    expect(rangeSince('nonsense', NOW)).toBeNull();
  });

  it('a search takes % _ and \\ literally', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(likePattern('sale')).toBe('%sale%');
  });
});

describe('insights (TW-FB-019)', () => {
  it('the latest value of each metric by name; a missing or odd value is 0; a dropped metric is absent', () => {
    expect(
      kpisFrom([
        { name: 'page_impressions', values: [{ value: 5 }, { value: 12 }] },
        { name: 'page_views_total', values: [{ value: '7' }] },
        { name: 'page_fan_adds', values: [{ value: { odd: true } }] },
        { name: 'page_post_engagements', values: [] },
        { values: [{ value: 1 }] },
      ]),
    ).toEqual({
      page_impressions: 12,
      page_views_total: 7,
      page_fan_adds: 0,
      page_post_engagements: 0,
    });
    expect(kpisFrom([])).toEqual({});
  });

  it('a post’s impressions and engaged users', () => {
    expect(
      postStats([
        { name: 'post_impressions', values: [{ value: 40 }] },
        { name: 'post_engaged_users', values: [{ value: 3 }] },
      ]),
    ).toEqual({ impressions: 40, engaged: 3 });
    expect(postStats([])).toEqual({ impressions: 0, engaged: 0 });
  });

  it('a time zone is kept when real and is UTC otherwise', () => {
    expect(validTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(validTimeZone('Not/AZone')).toBe('UTC');
    expect(validTimeZone(undefined)).toBe('UTC');
    expect(validTimeZone('')).toBe('UTC');
  });

  it('the day is read in the viewer’s zone', () => {
    const late = new Date('2026-10-02T20:00:00Z');
    expect(dayIn('UTC', late)).toBe('2026-10-02');
    expect(dayIn('Asia/Kolkata', late)).toBe('2026-10-03');
    expect(dayIn('America/Los_Angeles', new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-01');
  });

  it('the last 14 days end today in the zone, oldest first, with no day skipped or repeated across a clock change', () => {
    const d = lastDays('UTC', NOW, 14);
    expect(d).toHaveLength(14);
    expect(d[0]).toBe('2026-09-19');
    expect(d.at(-1)).toBe('2026-10-02');
    expect(lastDays('Asia/Kolkata', new Date('2026-10-02T20:00:00Z'), 3)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    // The night the clocks went back in New York (2026-11-01) and the night they went forward (2026-03-08).
    for (const at of ['2026-11-02T06:00:00Z', '2026-03-09T06:00:00Z']) {
      const days = lastDays('America/New_York', new Date(at), 14);
      expect(new Set(days).size).toBe(14);
      for (let i = 1; i < days.length; i++) {
        expect(Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`)).toBe(
          86_400_000,
        );
      }
    }
  });
});
