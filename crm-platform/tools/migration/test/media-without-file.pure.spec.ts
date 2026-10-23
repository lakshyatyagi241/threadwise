import { describe, expect, it } from 'vitest';
import { parseTurn } from '../inbox/parse';

/** Pure: a file or image message whose dump has no URL is flagged, so the files step reports it as a known gap, not a failure. */
describe('a media message with no file in the dump', () => {
  it('an image with a caption but no URL is kept with its caption, flagged, with a soft issue', () => {
    const t = parseTurn({ user_query_object: { type: 'image', isUser: true, value: { text: 'Building fund' } } });
    expect(t.kind).toBe('image');
    expect(t.mediaUrl).toBeNull();
    expect(t.body).toBe('Building fund');
    expect(t.legacy.contentUnavailable).toBe(true);
    expect(t.soft.map((x) => x.code)).toContain('MEDIA_UNAVAILABLE');
  });

  it('an audio with an empty url object is flagged too', () => {
    const t = parseTurn({ user_query_object: { type: 'audio', isUser: true, value: { url: null } } });
    expect(t.kind).toBe('audio');
    expect(t.legacy.contentUnavailable).toBe(true);
  });

  it('a media message that has a URL is not flagged', () => {
    const t = parseTurn({
      user_query_object: { type: 'image', isUser: true, value: { url: 'https://files.example.test/a/pic.jpg' } },
    });
    expect(t.mediaUrl).toBe('https://files.example.test/a/pic.jpg');
    expect(t.legacy.contentUnavailable).toBeUndefined();
  });

  it('a text message is not flagged', () => {
    const t = parseTurn({ user_query_object: { type: 'text', isUser: true, value: 'hello' } });
    expect(t.legacy.contentUnavailable).toBeUndefined();
  });
});
