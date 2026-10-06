import { describe, expect, it } from 'vitest';
import {
  v1ListConversationsQuerySchema,
  v1ListMessagesQuerySchema,
  v1SendMessageSchema,
} from '@crm/contracts';
import {
  digitsOf,
  hasCoordinates,
  mediaTypeOfMime,
  missingMedia,
  reportedType,
  wantsMedia,
} from '../../../src/modules/developer-rest-api-v1/resources/messaging/send-plan';

describe('single send: how a request is read (WD-API-110, 119)', () => {
  it('takes the digits of whatever the caller wrote as the number', () => {
    expect(digitsOf('+91 98123-45678')).toBe('919812345678');
    expect(digitsOf('919812345678@s.whatsapp.net')).toBe('919812345678');
    expect(digitsOf('call me')).toBe('');
  });

  it('reads text that carries a file as a media send, and a URL alone as an image', () => {
    expect(wantsMedia({ type: 'text', media_url: null }, true)).toBe(true);
    expect(wantsMedia({ type: undefined, media_url: 'https://x.test/a.png' }, false)).toBe(true);
    expect(wantsMedia({ type: 'text', media_url: null }, false)).toBe(false);
    expect(wantsMedia({ type: 'location', media_url: 'https://x.test/a.png' }, true)).toBe(false);
    expect(reportedType({ type: 'text', media_url: 'https://x.test/a.png' }, null)).toBe('image');
    expect(reportedType({ type: 'text', media_url: null }, { mime: 'application/pdf' })).toBe(
      'document',
    );
    expect(reportedType({ type: undefined, media_url: null }, { mime: 'audio/ogg' })).toBe('audio');
    expect(reportedType({ type: 'video', media_url: null }, { mime: 'image/png' })).toBe('video');
    expect(reportedType({ type: undefined, media_url: null }, null)).toBe('text');
  });

  it('wants a file only for an explicit media type with neither a file nor a URL (media_required)', () => {
    expect(missingMedia({ type: 'image', media_url: null }, false)).toBe(true);
    expect(missingMedia({ type: 'document', media_url: undefined }, false)).toBe(true);
    expect(missingMedia({ type: 'image', media_url: 'https://x.test/a.png' }, false)).toBe(false);
    expect(missingMedia({ type: 'audio', media_url: null }, true)).toBe(false);
    expect(missingMedia({ type: 'text', media_url: null }, false)).toBe(false);
    expect(missingMedia({ type: 'location', media_url: null }, false)).toBe(false);
  });

  it('counts a coordinate of 0 as missing, as WaDesk did', () => {
    expect(hasCoordinates({ latitude: 12.9, longitude: 77.6 })).toBe(true);
    expect(hasCoordinates({ latitude: 0, longitude: 77.6 })).toBe(false);
    expect(hasCoordinates({ latitude: 12.9, longitude: 0 })).toBe(false);
    expect(hasCoordinates({ latitude: 12.9, longitude: null })).toBe(false);
  });

  it('types a stored file by its sniffed MIME', () => {
    expect(mediaTypeOfMime('image/png')).toBe('image');
    expect(mediaTypeOfMime('video/mp4')).toBe('video');
    expect(mediaTypeOfMime('audio/ogg')).toBe('audio');
    expect(mediaTypeOfMime('application/pdf')).toBe('document');
    expect(mediaTypeOfMime('text/csv')).toBe('document');
  });
});

describe('POST /messages body (WD-API-110 rules 1)', () => {
  const parse = (body: unknown) => v1SendMessageSchema.safeParse(body);
  const fields = (body: unknown): string[] => {
    const r = parse(body);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  it('accepts the minimal send and trims, with an empty string meaning not sent', () => {
    const r = parse({ to: ' 919812345678 ', text: '  hi  ', device_id: '', type: '' });
    expect(r.success && r.data).toMatchObject({
      to: '919812345678',
      text: 'hi',
      device_id: null,
      type: null,
    });
  });

  it('requires `to`, a string of at most 32 characters', () => {
    expect(fields({})).toContain('to');
    expect(fields({ to: '   ' })).toContain('to');
    expect(fields({ to: 919812345678 })).toContain('to');
    expect(fields({ to: 'x'.repeat(33) })).toContain('to');
    expect(fields({ to: 'x'.repeat(32) })).toEqual([]);
  });

  it('reads a numeric device_id as text and caps it at 40', () => {
    const r = parse({ to: '1', device_id: 59 });
    expect(r.success && r.data.device_id).toBe('59');
    expect(fields({ to: '1', device_id: 'd'.repeat(65) })).toContain('device_id');
  });

  it('allows only the six types', () => {
    for (const type of ['text', 'image', 'video', 'document', 'audio', 'location'])
      expect(fields({ to: '1', type })).toEqual([]);
    expect(fields({ to: '1', type: 'sticker' })).toContain('type');
  });

  it('caps the text at 4096 and the URL at 2048 and wants a URL', () => {
    expect(fields({ to: '1', text: 'a'.repeat(4096) })).toEqual([]);
    expect(fields({ to: '1', text: 'a'.repeat(4097) })).toContain('text');
    expect(fields({ to: '1', media_url: 'not a url' })).toContain('media_url');
    expect(fields({ to: '1', media_url: `https://x.test/${'a'.repeat(2048)}` })).toContain(
      'media_url',
    );
  });

  it('range-checks the coordinates and reads numeric strings from a multipart form', () => {
    expect(fields({ to: '1', latitude: 91 })).toContain('latitude');
    expect(fields({ to: '1', longitude: -181 })).toContain('longitude');
    expect(fields({ to: '1', latitude: 'abc' })).toContain('latitude');
    const r = parse({ to: '1', latitude: '12.9', longitude: '77.6' });
    expect(r.success && [r.data.latitude, r.data.longitude]).toEqual([12.9, 77.6]);
  });
});

describe('message and conversation lists clamp instead of refusing (WD-API-111, 114, 115)', () => {
  it('GET /messages: default 50, 1 to 200, a bad value becomes 1', () => {
    const limit = (q: Record<string, unknown>) => v1ListMessagesQuerySchema.parse(q).limit;
    expect(limit({})).toBe(50);
    expect(limit({ limit: '500' })).toBe(200);
    expect(limit({ limit: '0' })).toBe(1);
    expect(limit({ limit: 'abc' })).toBe(1);
    expect(limit({ limit: '-5' })).toBe(1);
    expect(limit({ per_page: '30' })).toBe(30);
    expect(limit({ limit: '7', per_page: '30' })).toBe(7);
  });

  it('GET /conversations: default 25, 1 to 100', () => {
    const limit = (q: Record<string, unknown>) => v1ListConversationsQuerySchema.parse(q).limit;
    expect(limit({})).toBe(25);
    expect(limit({ per_page: '1000' })).toBe(100);
  });

  it('refuses a page number, naming the cursor', () => {
    const r = v1ListMessagesQuerySchema.safeParse({ page: '2' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('cursor');
  });
});
