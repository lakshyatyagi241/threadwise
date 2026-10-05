import { describe, expect, it } from 'vitest';
import {
  buildCreateInput,
  emptyCompose,
  previewMedia,
  splitUrls,
  submitKey,
  zonedLocalToInstant,
  type ComposeState,
} from './compose-model';

const base = (over: Partial<ComposeState> = {}): ComposeState => ({
  ...emptyCompose('page-1'),
  ...over,
});

describe('web addresses in a box', () => {
  it('splits on lines, commas and spaces and drops what is not a web address', () => {
    expect(
      splitUrls('https://a/1.jpg\nhttp://b/2.jpg, https://c/3.jpg  ftp://x/y not-a-url'),
    ).toEqual(['https://a/1.jpg', 'http://b/2.jpg', 'https://c/3.jpg']);
    expect(splitUrls('')).toEqual([]);
  });
});

describe('a time in a zone', () => {
  it('reads a local time as the instant it names, including across daylight saving', () => {
    expect(zonedLocalToInstant('2026-10-02T12:00', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-10-02T06:30:00.000Z',
    );
    expect(zonedLocalToInstant('2026-07-01T09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(zonedLocalToInstant('2026-12-01T09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
    expect(zonedLocalToInstant('2026-10-02T12:00', 'UTC')?.toISOString()).toBe(
      '2026-10-02T12:00:00.000Z',
    );
  });

  it('a value that is not a local time is null', () => {
    expect(zonedLocalToInstant('', 'UTC')).toBeNull();
    expect(zonedLocalToInstant('tomorrow', 'UTC')).toBeNull();
  });
});

describe('what a post is sent as (WD-FB-016)', () => {
  it('a photo post sends its photos and the message, trimmed', () => {
    const r = buildCreateInput(
      base({ message: '  Hello  ', photoText: 'https://a/1.jpg, https://a/2.jpg' }),
      'UTC',
    );
    expect(r).toEqual({
      ok: true,
      input: {
        pageId: 'page-1',
        message: 'Hello',
        photoUrls: ['https://a/1.jpg', 'https://a/2.jpg'],
      },
    });
  });

  it('only the fields of the chosen type go: text left in another box never reaches the post', () => {
    const left = {
      photoText: 'https://a/1.jpg',
      link: 'https://x.test',
      videoUrl: 'https://v/clip.mp4',
      message: 'm',
    };
    expect(buildCreateInput(base({ ...left, type: 'link' }), 'UTC')).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'm', link: 'https://x.test' },
    });
    expect(buildCreateInput(base({ ...left, type: 'video' }), 'UTC')).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'm', videoUrl: 'https://v/clip.mp4' },
    });
    expect(buildCreateInput(base({ ...left, type: 'reel' }), 'UTC')).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'm', videoUrl: 'https://v/clip.mp4', asReel: true },
    });
    expect(buildCreateInput(base({ ...left, type: 'multi_photo' }), 'UTC')).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'm', photoUrls: ['https://a/1.jpg'] },
    });
  });

  it('a text-only post is a photo-type post with nothing attached: the message alone', () => {
    expect(buildCreateInput(base({ message: 'Just words' }), 'UTC')).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'Just words' },
    });
  });

  it('no Page is refused before anything is sent', () => {
    expect(buildCreateInput(base({ pageId: '' }), 'UTC')).toEqual({ ok: false, problem: 'noPage' });
  });

  it('"later" needs a time, and sends it as an instant in the viewer’s zone', () => {
    expect(buildCreateInput(base({ message: 'x', when: 'later' }), 'UTC')).toEqual({
      ok: false,
      problem: 'scheduleMissing',
    });
    expect(
      buildCreateInput(base({ message: 'x', when: 'later', scheduledLocal: 'soon' }), 'UTC'),
    ).toEqual({ ok: false, problem: 'scheduleInvalid' });
    const r = buildCreateInput(
      base({ message: 'x', when: 'later', scheduledLocal: '2026-10-02T12:00' }),
      'Asia/Kolkata',
    );
    expect(r).toEqual({
      ok: true,
      input: { pageId: 'page-1', message: 'x', scheduledAt: '2026-10-02T06:30:00.000Z' },
    });
  });
});

describe('the live preview and the button', () => {
  it('shows what the chosen type will post', () => {
    expect(previewMedia(base())).toEqual({ kind: 'none' });
    expect(previewMedia(base({ photoText: 'https://a/1.jpg https://a/2.jpg' }))).toEqual({
      kind: 'photos',
      photos: ['https://a/1.jpg'],
    });
    expect(
      previewMedia(base({ type: 'multi_photo', photoText: 'https://a/1.jpg https://a/2.jpg' })),
    ).toEqual({ kind: 'photos', photos: ['https://a/1.jpg', 'https://a/2.jpg'] });
    expect(previewMedia(base({ type: 'link', link: ' https://x.test ' }))).toEqual({
      kind: 'link',
      url: 'https://x.test',
    });
    expect(previewMedia(base({ type: 'reel', videoUrl: 'https://v/c.mp4' }))).toEqual({
      kind: 'video',
      url: 'https://v/c.mp4',
      reel: true,
    });
  });

  it('the button says Publish, or Schedule for later', () => {
    expect(submitKey(base())).toBe('publish');
    expect(submitKey(base({ when: 'later' }))).toBe('schedule');
  });
});
