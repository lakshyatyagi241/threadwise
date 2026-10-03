import { describe, expect, it } from 'vitest';
import {
  SDP_MIN_LENGTH,
  foldToCrlf,
  forceSetupActive,
  isMetaCodec,
  isUsableSdp,
  keepOpusCodecs,
  normalizeRemoteSdp,
} from './sdp';

describe('foldToCrlf', () => {
  it('turns bare LF into CRLF and ends with CRLF', () => {
    expect(foldToCrlf('v=0\ns=-')).toBe('v=0\r\ns=-\r\n');
  });
  it('leaves CRLF alone and does not double the trailing one', () => {
    expect(foldToCrlf('v=0\r\ns=-\r\n')).toBe('v=0\r\ns=-\r\n');
  });
  it('folds lone CR as well', () => {
    expect(foldToCrlf('a\rb\n')).toBe('a\r\nb\r\n');
  });
});

describe('forceSetupActive', () => {
  it('rewrites the ambiguous actpass to active', () => {
    expect(forceSetupActive('a=setup:actpass\na=mid:0')).toBe('a=setup:active\na=mid:0');
    expect(forceSetupActive('a=setup:actpass\r\na=mid:0')).toBe('a=setup:active\r\na=mid:0');
  });
  it('leaves a concrete role untouched', () => {
    expect(forceSetupActive('a=setup:passive\na=setup:active')).toBe(
      'a=setup:passive\na=setup:active',
    );
  });
});

describe('normalizeRemoteSdp', () => {
  const sdp = 'v=0\na=setup:actpass\nm=audio 9 RTP/AVP 111';
  it('pins the DTLS role only on an answer', () => {
    expect(normalizeRemoteSdp(sdp, 'answer')).toBe(
      'v=0\r\na=setup:active\r\nm=audio 9 RTP/AVP 111\r\n',
    );
    expect(normalizeRemoteSdp(sdp, 'offer')).toBe(
      'v=0\r\na=setup:actpass\r\nm=audio 9 RTP/AVP 111\r\n',
    );
  });
});

describe('isUsableSdp', () => {
  it('needs the 50 character minimum', () => {
    expect(SDP_MIN_LENGTH).toBe(50);
    expect(isUsableSdp('x'.repeat(49))).toBe(false);
    expect(isUsableSdp('x'.repeat(50))).toBe(true);
    expect(isUsableSdp(null)).toBe(false);
    expect(isUsableSdp(undefined)).toBe(false);
    expect(isUsableSdp('')).toBe(false);
  });
});

describe('keepOpusCodecs', () => {
  const codecs = [
    { mimeType: 'audio/opus', clockRate: 48000 },
    { mimeType: 'audio/PCMU' },
    { mimeType: 'audio/PCMA' },
    { mimeType: 'audio/G722' },
    { mimeType: 'audio/CN' },
    { mimeType: 'audio/telephone-event' },
    { mimeType: 'audio/red' },
  ];
  it('keeps only Opus and telephone-event, in order', () => {
    expect(keepOpusCodecs(codecs).map((c) => c.mimeType)).toEqual([
      'audio/opus',
      'audio/telephone-event',
    ]);
  });
  it('matches case-insensitively', () => {
    expect(isMetaCodec('audio/OPUS')).toBe(true);
    expect(isMetaCodec('audio/Telephone-Event')).toBe(true);
    expect(isMetaCodec('audio/PCMU')).toBe(false);
  });
  it('returns an empty list when there is no Opus', () => {
    expect(keepOpusCodecs([{ mimeType: 'audio/PCMU' }])).toEqual([]);
  });
});
