import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { checkFile, chatErrorDetail, chatErrorKind, libraryErrorKind } from './errors';

const api = (status: number, code: string) => new ApiError(status, code, 'x');

describe('libraryErrorKind', () => {
  it('branches on the stable code', () => {
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_AI_KEY_MISSING))).toBe('keyRequired');
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED))).toBe(
      'providerUnsupported',
    );
    expect(libraryErrorKind(api(413, ERROR_CODES.REPORT_DOC_TOO_LARGE))).toBe('tooBig');
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_DOC_TYPE_UNSUPPORTED))).toBe('badType');
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_DOC_UNREADABLE))).toBe('unreadable');
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_DOC_NO_TEXT))).toBe('unreadable');
    expect(libraryErrorKind(api(422, ERROR_CODES.REPORT_DOC_LIMIT_REACHED))).toBe('full');
  });
  it('falls back on the status, and treats a non-API error as a network failure', () => {
    expect(libraryErrorKind(api(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(libraryErrorKind(api(413, 'UNKNOWN'))).toBe('tooBig');
    expect(libraryErrorKind(api(500, 'INTERNAL'))).toBe('generic');
    expect(libraryErrorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
});

describe('chatErrorKind', () => {
  it('finds the missing-key code in a failed run', () => {
    const run = Object.assign(
      new Error(`HTTP 422: "{\\"code\\":\\"${ERROR_CODES.REPORT_AI_KEY_MISSING}\\"}"`),
      { status: 422 },
    );
    expect(chatErrorKind(run)).toBe('keyRequired');
    const payload = Object.assign(new Error('HTTP 422'), {
      payload: { code: ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED },
    });
    expect(chatErrorKind(payload)).toBe('providerUnsupported');
  });
  it('reads a 422 on the first contact as the key problem', () => {
    const info = Object.assign(new Error('Runtime info request failed with status 422'), {
      runtimeInfoStatus: 422,
    });
    expect(chatErrorKind(info)).toBe('keyRequired');
  });
  it('treats everything else as an ordinary failure', () => {
    expect(chatErrorKind(new Error('boom'))).toBe('generic');
    expect(chatErrorKind(Object.assign(new Error('x'), { runtimeInfoStatus: 500 }))).toBe(
      'generic',
    );
    expect(chatErrorKind(undefined)).toBe('generic');
    expect(chatErrorKind('text')).toBe('generic');
  });
});

describe('checkFile', () => {
  const ext = ['pdf', 'docx', 'txt'];
  it('accepts a known extension within the size, whatever its case', () => {
    expect(checkFile({ name: 'Plan.PDF', size: 10 }, ext, 100)).toBe('ok');
  });
  it('refuses an unknown or missing extension', () => {
    expect(checkFile({ name: 'a.exe', size: 1 }, ext, 100)).toBe('badType');
    expect(checkFile({ name: 'README', size: 1 }, ext, 100)).toBe('badType');
    expect(checkFile({ name: 'old.doc', size: 1 }, ext, 100)).toBe('badType');
  });
  it('refuses a file over the limit, and takes one exactly at it', () => {
    expect(checkFile({ name: 'a.txt', size: 101 }, ext, 100)).toBe('tooBig');
    expect(checkFile({ name: 'a.txt', size: 100 }, ext, 100)).toBe('ok');
  });
});

describe('chatErrorDetail', () => {
  it('passes on the API sentence of a failed run', () => {
    expect(
      chatErrorDetail(
        new Error('The AI provider did not accept the key. Check the AI key in Settings.'),
      ),
    ).toBe('The AI provider did not accept the key. Check the AI key in Settings.');
  });
  it('keeps the page wording for transport failures and long text', () => {
    expect(chatErrorDetail(new Error('HTTP 502: bad gateway'))).toBeNull();
    expect(chatErrorDetail(new Error('Failed to fetch'))).toBeNull();
    expect(chatErrorDetail(new Error('x'.repeat(300)))).toBeNull();
    expect(chatErrorDetail(undefined)).toBeNull();
  });
});
