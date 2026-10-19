import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { changePassword, enableMfa, resendVerification, startMfaSetup } from './gates-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the lock screens API', () => {
  it('asks for the verification mail again, with the session, and reads the answer', async () => {
    const http = mockFetch(jsonResponse(200, { sent: true, alreadyVerified: false }));
    await expect(resendVerification()).resolves.toEqual({ sent: true, alreadyVerified: false });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/auth/verify-email/resend');
    expect(http.calls[0]?.init.method).toBe('POST');
    expect(http.calls[0]?.headers.Authorization).toBeDefined();
  });

  it('reads the reason a mail could not be sent', async () => {
    mockFetch(jsonResponse(200, { sent: false, alreadyVerified: false, reason: 'timeout' }));
    await expect(resendVerification()).resolves.toMatchObject({ reason: 'timeout' });
  });

  it('changes the password with both passwords in the body', async () => {
    const http = mockFetch(jsonResponse(200, { revokedOtherSessions: 2 }));
    await changePassword({ currentPassword: 'Old-Password-1', newPassword: 'New-Password-2026' });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/account/password');
    expect(http.calls[0]?.body).toEqual({
      currentPassword: 'Old-Password-1',
      newPassword: 'New-Password-2026',
    });
  });

  it('starts the authenticator setup, with the password only when one is given', async () => {
    const setup = {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/x',
      expiresInSeconds: 600,
    };
    const http = mockFetch(jsonResponse(200, setup), jsonResponse(200, setup));
    await expect(startMfaSetup({})).resolves.toEqual(setup);
    await startMfaSetup({ password: 'Old-Password-1' });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/account/mfa/setup');
    expect(http.calls[0]?.body).toEqual({});
    expect(http.calls[1]?.body).toEqual({ password: 'Old-Password-1' });
  });

  it('turns two-factor on with the first code and reads the recovery codes', async () => {
    const http = mockFetch(jsonResponse(200, { recoveryCodes: ['aaaa-1111', 'bbbb-2222'] }));
    await expect(enableMfa({ code: '123456' })).resolves.toEqual({
      recoveryCodes: ['aaaa-1111', 'bbbb-2222'],
    });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/account/mfa/enable');
    expect(http.calls[0]?.body).toEqual({ code: '123456' });
  });

  it('refuses a setup answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { secret: 42 }));
    await expect(startMfaSetup({})).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });
});
