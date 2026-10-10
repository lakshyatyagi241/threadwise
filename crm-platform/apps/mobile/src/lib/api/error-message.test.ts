import { i18n, initI18n } from '@/lib/i18n';
import { messageForError } from './error-message';
import { ApiError, CLIENT_ERROR_CODES } from './errors';

beforeAll(async () => {
  await initI18n('en');
});

const t = i18n.t.bind(i18n);

describe('messageForError', () => {
  it('chooses by code, not by the server’s text', () => {
    expect(messageForError(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'), t)).toMatch(
      /Can't reach the server/,
    );
    expect(messageForError(new ApiError(0, CLIENT_ERROR_CODES.TIMEOUT, 'x'), t)).toMatch(
      /too long/,
    );
    expect(
      messageForError(new ApiError(200, CLIENT_ERROR_CODES.CONTRACT_MISMATCH, 'x'), t),
    ).toMatch(/out of date/);
  });

  it('tells the person to slow down on a 429', () => {
    expect(messageForError(new ApiError(429, 'RATE_LIMITED', 'x'), t)).toMatch(/Too many attempts/);
  });

  it('falls back to a generic message for anything else, including non-API errors', () => {
    expect(messageForError(new ApiError(500, 'INTERNAL', 'stack trace here'), t)).toBe(
      'Something went wrong. Please try again.',
    );
    expect(messageForError(new Error('boom'), t)).toBe('Something went wrong. Please try again.');
    expect(messageForError(undefined, t)).toBe('Something went wrong. Please try again.');
  });
});
