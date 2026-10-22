import { describe, expect, it } from 'vitest';
import {
  MESSAGE_KIND_CLASS,
  SOURCE_KIND,
  feedType,
  messageKindClass,
  packFeedClass,
  unpackFeedClass,
} from '@crm/contracts';

describe('feed class packing', () => {
  it('round-trips every source and kind class', () => {
    for (const source of Object.values(SOURCE_KIND)) {
      for (const kind of Object.values(MESSAGE_KIND_CLASS)) {
        expect(unpackFeedClass(packFeedClass(source, kind))).toEqual({ source, kindClass: kind });
      }
    }
  });

  it('keeps two different pairs apart', () => {
    const seen = new Set<number>();
    for (const source of Object.values(SOURCE_KIND)) {
      for (const kind of Object.values(MESSAGE_KIND_CLASS)) seen.add(packFeedClass(source, kind));
    }
    expect(seen.size).toBe(
      Object.keys(SOURCE_KIND).length * Object.keys(MESSAGE_KIND_CLASS).length,
    );
  });

  it('refuses a code that would overflow its half', () => {
    expect(() => packFeedClass(16, 1)).toThrow(RangeError);
    expect(() => packFeedClass(1, 16)).toThrow(RangeError);
    expect(() => packFeedClass(-1, 1)).toThrow(RangeError);
    expect(() => unpackFeedClass(1.5)).toThrow(RangeError);
  });

  it('fits in the small range the packing assumes: every code in use is below 16', () => {
    for (const v of [...Object.values(SOURCE_KIND), ...Object.values(MESSAGE_KIND_CLASS)]) {
      expect(v).toBeLessThan(16);
    }
  });
});

describe('message kind class', () => {
  it('maps the thirteen message kinds the way the history groups them', () => {
    const expected: Record<string, number> = {
      text: MESSAGE_KIND_CLASS.text,
      template: MESSAGE_KIND_CLASS.template,
      image: MESSAGE_KIND_CLASS.image,
      video: MESSAGE_KIND_CLASS.video,
      audio: MESSAGE_KIND_CLASS.audio,
      voice: MESSAGE_KIND_CLASS.audio,
      document: MESSAGE_KIND_CLASS.document,
      sticker: MESSAGE_KIND_CLASS.document,
      location: MESSAGE_KIND_CLASS.location,
      contact: MESSAGE_KIND_CLASS.other,
      interactive: MESSAGE_KIND_CLASS.other,
      reaction: MESSAGE_KIND_CLASS.other,
      system: MESSAGE_KIND_CLASS.other,
    };
    for (const [kind, cls] of Object.entries(expected))
      expect(messageKindClass(kind), kind).toBe(cls);
    expect(messageKindClass('something-new')).toBe(MESSAGE_KIND_CLASS.other);
  });
});

describe('feedType', () => {
  const type = (source: number, kind: string) =>
    feedType(packFeedClass(source, messageKindClass(kind)));

  it('the automated sources are their own type whatever the kind', () => {
    expect(type(SOURCE_KIND.auto_reply, 'image')).toBe('auto_reply');
    expect(type(SOURCE_KIND.broadcast, 'template')).toBe('broadcast');
  });

  it('otherwise the kind decides: media, template, or text', () => {
    expect(type(SOURCE_KIND.inbox, 'image')).toBe('image');
    expect(type(SOURCE_KIND.flow, 'voice')).toBe('audio');
    expect(type(SOURCE_KIND.ai, 'sticker')).toBe('document');
    expect(type(SOURCE_KIND.api, 'location')).toBe('location');
    expect(type(SOURCE_KIND.campaign, 'template')).toBe('template'); // a campaign message is typed by its kind, as messageType() does
    expect(type(SOURCE_KIND.inbox, 'text')).toBe('text');
    expect(type(SOURCE_KIND.inbox, 'interactive')).toBe('text');
    expect(type(SOURCE_KIND.other, 'contact')).toBe('text');
  });
});
