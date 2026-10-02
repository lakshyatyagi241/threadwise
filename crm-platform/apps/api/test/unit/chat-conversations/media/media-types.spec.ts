import { describe, expect, it } from 'vitest';
import {
  isInlineMime,
  kindOfMime,
  mimeForKey,
  servableMime,
  sniffMediaType,
} from '../../../../src/infra/providers/chat-conversations/media/media-types';

const pad = (head: number[] | string, total = 32) => {
  const h = typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head);
  return Buffer.concat([h, Buffer.alloc(Math.max(0, total - h.length), 0x20)]);
};
const ftyp = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(16)]);

describe('sniffMediaType: the bytes decide', () => {
  it.each([
    ['jpeg', pad([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'jpg'],
    ['png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'png'],
    ['gif', pad('GIF89a'), 'image/gif', 'gif'],
    [
      'webp',
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WEBPVP8 '),
        Buffer.alloc(8),
      ]),
      'image/webp',
      'webp',
    ],
    [
      'wav',
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WAVEfmt '),
        Buffer.alloc(8),
      ]),
      'audio/wav',
      'wav',
    ],
    ['pdf', pad('%PDF-1.4'), 'application/pdf', 'pdf'],
    ['ogg', pad('OggS'), 'audio/ogg', 'ogg'],
    ['amr', pad('#!AMR\n'), 'audio/amr', 'amr'],
    ['mp3 with a tag', pad('ID3'), 'audio/mpeg', 'mp3'],
    ['mp3 frame', pad([0xff, 0xfb, 0x90]), 'audio/mpeg', 'mp3'],
    ['mp4', ftyp(), 'video/mp4', 'mp4'],
    ['webm', pad([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm', 'webm'],
    ['plain text', Buffer.from('just some words\n'), 'text/plain', 'txt'],
  ])('%s', (_name, bytes, mime, ext) => {
    expect(sniffMediaType(bytes)).toEqual({ mime, ext });
  });

  it('uses the declared type only to choose between formats that share a signature', () => {
    expect(sniffMediaType(ftyp(), 'audio/mp4')).toEqual({ mime: 'audio/mp4', ext: 'm4a' });
    expect(sniffMediaType(pad([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm')).toEqual({
      mime: 'audio/webm',
      ext: 'webm',
    });
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(sniffMediaType(pad([0x50, 0x4b, 3, 4]), docx)).toEqual({ mime: docx, ext: 'docx' });
    expect(sniffMediaType(pad([0x50, 0x4b, 3, 4]))).toEqual({
      mime: 'application/zip',
      ext: 'zip',
    });
    expect(sniffMediaType(Buffer.from('a,b\n1,2\n'), 'text/csv')).toEqual({
      mime: 'text/csv',
      ext: 'csv',
    });
  });

  it('never lets a declared type override the content: a PNG declared as a PDF is a PNG', () => {
    expect(
      sniffMediaType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'application/pdf')
        ?.mime,
    ).toBe('image/png');
  });

  it.each([
    ['html', Buffer.from('<!doctype html><html><body>x</body></html>')],
    ['a script as text', Buffer.from('  <script>alert(1)</script>')],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['php', Buffer.from('<?php system($_GET["c"]);')],
    ['binary noise', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])],
    ['nothing', Buffer.alloc(0)],
  ])('refuses %s', (_name, bytes) => {
    expect(sniffMediaType(bytes)).toBeNull();
  });
});

describe('kinds and serving', () => {
  it('sorts a mime type into the group its size limit belongs to', () => {
    expect(kindOfMime('image/png')).toBe('image');
    expect(kindOfMime('audio/ogg')).toBe('media');
    expect(kindOfMime('video/mp4')).toBe('media');
    expect(kindOfMime('application/pdf')).toBe('document');
    expect(kindOfMime('text/csv')).toBe('document');
  });

  it('shows images, audio, video and PDF inline and offers everything else as a download', () => {
    for (const m of ['image/png', 'audio/mpeg', 'video/mp4', 'application/pdf'])
      expect(isInlineMime(m)).toBe(true);
    for (const m of [
      'text/plain',
      'application/zip',
      'image/svg+xml',
      'text/html',
      'application/octet-stream',
    ]) {
      expect(isInlineMime(m)).toBe(false);
    }
  });

  it('falls back to the key extension, and to bytes for an unknown one', () => {
    expect(mimeForKey('chat/3/2026/10/a.PNG')).toBe('image/png');
    expect(mimeForKey('chat/3/2026/10/a.pdf')).toBe('application/pdf');
    expect(mimeForKey('chat/3/2026/10/a.weird')).toBe('application/octet-stream');
    expect(mimeForKey('chat/3/2026/10/noext')).toBe('application/octet-stream');
  });
});

describe('servableMime: what Content-Type a customer file is sent with', () => {
  it('echoes a type this store accepts, in lower case', () => {
    expect(servableMime('Image/PNG', 'chat/3/a.png')).toBe('image/png');
    expect(servableMime('application/pdf', 'chat/3/a.pdf')).toBe('application/pdf');
    expect(
      servableMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'chat/3/a.docx',
      ),
    ).toContain('wordprocessingml');
  });

  it('never echoes a type that would make a browser treat the file as a page or a script', () => {
    for (const bad of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/javascript',
      'application/javascript',
      'text/xml',
      'x/y',
    ]) {
      expect(servableMime(bad, 'chat/3/a.png')).toBe('image/png');
      expect(servableMime(bad, 'chat/3/a.weird')).toBe('application/octet-stream');
    }
  });

  it('falls back to the key extension when the link names no type', () => {
    expect(servableMime(undefined, 'chat/3/a.mp3')).toBe('audio/mpeg');
  });
});
