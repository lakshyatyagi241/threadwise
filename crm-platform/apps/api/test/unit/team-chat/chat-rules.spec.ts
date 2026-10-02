import { describe, expect, it } from 'vitest';
import {
  channelSlug,
  decodeMessageCursor,
  directSlug,
  encodeMessageCursor,
  escapeLike,
  extractMentionIds,
  isEmoji,
  quoteSnippet,
  safeFileName,
  sniffAttachment,
  withinEditWindow,
} from '../../../src/modules/team-chat/chat-rules';
import { createTchatChannelSchema, listTchatMessagesQuerySchema } from '@crm/contracts';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('channelSlug (WD-TCHAT-004)', () => {
  it('lower-cases and turns underscores into dashes, so dev_ops and dev-ops collide', () => {
    expect(channelSlug('Support_Team')).toBe('support-team');
    expect(channelSlug('dev_ops')).toBe(channelSlug('dev-ops'));
  });
});

describe('channel name validation (WD-TCHAT-004)', () => {
  const ok = (name: string) => createTchatChannelSchema.safeParse({ name, type: 'public' }).success;
  it('accepts letters, digits, dash and underscore, starting with a letter or digit', () => {
    expect(ok('Support_Team')).toBe(true);
    expect(ok('2024-plan')).toBe(true);
  });
  it('refuses a leading dash, spaces and more than 64 characters', () => {
    expect(ok('-abc')).toBe(false);
    expect(ok('has space')).toBe(false);
    expect(ok('a'.repeat(65))).toBe(false);
  });
  it('only public and private can be created; dm is not', () => {
    expect(createTchatChannelSchema.safeParse({ name: 'x', type: 'dm' }).success).toBe(false);
  });
});

describe('extractMentionIds (WD-TCHAT-012)', () => {
  it('reads the user uuid of each @[Name](uuid) token once, in order', () => {
    expect(
      extractMentionIds(`hi @[Sam](${U1}) and @[Sara](${U2}) and again @[Sam](${U1})`),
    ).toEqual([U1, U2]);
  });
  it('ignores text that only looks like a token', () => {
    expect(extractMentionIds('@Sam (7) @[Sam](7) @[](x)')).toEqual([]);
  });
  it('lower-cases the id so it matches the stored uuid', () => {
    expect(extractMentionIds(`@[A](${U1.toUpperCase()})`)).toEqual([U1]);
  });
});

describe('quoteSnippet (WD-TCHAT-011)', () => {
  it('keeps the first 80 characters and shows a mention as its name', () => {
    expect(quoteSnippet('x'.repeat(100))).toHaveLength(80);
    expect(quoteSnippet(`hello @[Sam](${U1})`)).toBe('hello @Sam');
    expect(quoteSnippet(null)).toBe('');
  });
  it('does not cut an emoji in half', () => {
    expect(quoteSnippet('😀'.repeat(100))).toBe('😀'.repeat(80));
  });
});

describe('withinEditWindow (WD-TCHAT-017)', () => {
  const sent = new Date('2026-01-01T10:00:00Z');
  it('allows an edit up to 15 minutes after sending and refuses it after', () => {
    expect(withinEditWindow(sent, new Date('2026-01-01T10:05:00Z'))).toBe(true);
    expect(withinEditWindow(sent, new Date('2026-01-01T10:15:00Z'))).toBe(true);
    expect(withinEditWindow(sent, new Date('2026-01-01T10:15:01Z'))).toBe(false);
    expect(withinEditWindow(sent, new Date('2026-01-01T10:20:00Z'))).toBe(false);
  });
});

describe('directSlug (WD-TCHAT-007)', () => {
  it('is the same for the pair whichever user opens it', () => {
    expect(directSlug(7, 3)).toBe('dm-3-7');
    expect(directSlug(3, 7)).toBe(directSlug(7, 3));
  });
});

describe('isEmoji (WD-TCHAT-019)', () => {
  it('accepts pictographs, skin tones, ZWJ sequences, flags and keycaps', () => {
    for (const e of ['👍', '👍🏽', '👨‍👩‍👧', '🇮🇳', '❤️', '1️⃣']) expect(isEmoji(e), e).toBe(true);
  });
  it('refuses words, digits and mixed text', () => {
    for (const e of ['a', 'thumbs', '1', '👍a', '']) expect(isEmoji(e), e).toBe(false);
  });
});

describe('sniffAttachment (WD-TCHAT-010)', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it('names an image by its bytes, whatever the file is called', () => {
    expect(sniffAttachment(png, 'cat.txt')).toEqual({ mime: 'image/png', isImage: true });
    expect(sniffAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.bin')?.mime).toBe(
      'image/jpeg',
    );
    expect(sniffAttachment(Buffer.from('GIF89a....'), 'a')?.mime).toBe('image/gif');
  });
  it('accepts a PDF, plain text and csv; refuses SVG, scripts, executables and empty files', () => {
    expect(sniffAttachment(Buffer.from('%PDF-1.7 ...'), 'x.pdf')?.mime).toBe('application/pdf');
    expect(sniffAttachment(Buffer.from('hello'), 'notes.txt')?.mime).toBe('text/plain');
    expect(sniffAttachment(Buffer.from('a,b'), 'sheet.csv')?.mime).toBe('text/csv');
    expect(sniffAttachment(Buffer.from('<svg onload=alert(1)>'), 'x.svg')).toBeNull();
    expect(sniffAttachment(Buffer.from('MZ\x90\x00'), 'x.exe')).toBeNull();
    expect(sniffAttachment(Buffer.from('#!/bin/sh'), 'x.sh')).toBeNull();
    expect(sniffAttachment(Buffer.alloc(0), 'x.txt')).toBeNull();
  });
  it('a .txt with binary content is refused', () => {
    expect(sniffAttachment(Buffer.from([0x68, 0x00, 0x69]), 'x.txt')).toBeNull();
  });
  it('an office file needs both the zip header and the right extension', () => {
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml'),
    ]);
    expect(sniffAttachment(zip, 'a.docx')?.mime).toContain('wordprocessingml');
    expect(sniffAttachment(zip, 'a.zip')).toBeNull();
  });
});

describe('cursor and search helpers', () => {
  it('a history cursor round-trips and a forged one is refused', () => {
    expect(decodeMessageCursor(encodeMessageCursor(1234))).toBe(1234);
    expect(decodeMessageCursor('not-a-cursor')).toBeNull();
    expect(decodeMessageCursor(Buffer.from('m:1;drop', 'utf8').toString('base64url'))).toBeNull();
  });
  it('LIKE wildcards in a search needle are literals', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
  it('a file name loses its path and control characters and is capped', () => {
    expect(safeFileName('C:\\temp\\..\\a"b.png')).toBe('ab.png');
    expect(safeFileName('x'.repeat(300))).toHaveLength(191);
    expect(safeFileName('')).toBe('file');
  });
});

describe('history page size (WD-TCHAT-008)', () => {
  const limit = (v?: string) => listTchatMessagesQuerySchema.parse({ limit: v }).limit;
  it('defaults to 50 and clamps to 10..50', () => {
    expect(limit()).toBe(50);
    expect(limit('5')).toBe(10);
    expect(limit('500')).toBe(50);
    expect(limit('20')).toBe(20);
  });
});
