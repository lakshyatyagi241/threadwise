import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { classifyPasskeyError } from './passkey-failure';

/** What `@simplewebauthn/browser` throws: the DOMException's name is kept, a `code` says why. */
function webauthnError(name: string, code: string): Error {
  return Object.assign(new Error(`${name}: ${code}`), { name, code });
}

describe('classifyPasskeyError: API answers', () => {
  it.each([
    [409, ERROR_CODES.AUTH_PASSKEY_NEEDS_MFA, 'needsMfa'],
    [403, ERROR_CODES.AUTH_REAUTH_REQUIRED, 'reauth'],
    [400, ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG, 'wrongPassword'],
    [400, ERROR_CODES.AUTH_PASSKEY_INVALID, 'invalid'],
    [409, ERROR_CODES.AUTH_PASSKEY_LIMIT, 'limit'],
    [400, ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED, 'challengeExpired'],
    [404, ERROR_CODES.NOT_FOUND, 'notFound'],
  ] as const)('%i %s is %s', (status, code, expected) => {
    expect(classifyPasskeyError(new ApiError(status, code, 'x'))).toBe(expected);
  });

  it('treats any other API code as an ordinary failure', () => {
    expect(classifyPasskeyError(new ApiError(500, ERROR_CODES.INTERNAL, 'x'))).toBe('other');
  });
});

describe('classifyPasskeyError: the browser prompt', () => {
  it('a closed or timed-out prompt is a cancellation, not an error', () => {
    expect(
      classifyPasskeyError(
        webauthnError('NotAllowedError', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'),
      ),
    ).toBe('cancelled');
    expect(classifyPasskeyError(webauthnError('AbortError', 'ERROR_CEREMONY_ABORTED'))).toBe(
      'cancelled',
    );
  });

  it('an authenticator that already holds a passkey for the account is named', () => {
    expect(
      classifyPasskeyError(
        webauthnError('InvalidStateError', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'),
      ),
    ).toBe('alreadyRegistered');
  });

  it('a device without the needed capability is unsupported', () => {
    expect(
      classifyPasskeyError(
        webauthnError('NotSupportedError', 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'),
      ),
    ).toBe('unsupported');
    expect(
      classifyPasskeyError(
        webauthnError('ConstraintError', 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT'),
      ),
    ).toBe('unsupported');
  });

  it('anything else, including a thrown string, is "other"', () => {
    expect(classifyPasskeyError(webauthnError('SecurityError', 'ERROR_INVALID_RP_ID'))).toBe(
      'other',
    );
    expect(classifyPasskeyError(new Error('boom'))).toBe('other');
    expect(classifyPasskeyError('boom')).toBe('other');
    expect(classifyPasskeyError(undefined)).toBe('other');
  });
});
