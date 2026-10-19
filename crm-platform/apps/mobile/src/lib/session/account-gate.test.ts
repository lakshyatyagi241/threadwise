import type { SessionResponse } from '@crm/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '@/lib/api/errors';
import { createQueryClient } from '@/lib/query/query-client';
import { session as base } from '@/test/dashboard-fixtures';
import {
  clearWorkspaceSuspended,
  gateOf,
  noteGateError,
  useWorkspaceSuspended,
} from './account-gate';
import { sessionKey } from './use-session';

const flags = (over: Partial<SessionResponse['flags']>): SessionResponse => ({
  ...base,
  flags: {
    suspended: false,
    emailUnverified: false,
    emailBlocked: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
    ...over,
  },
});

afterEach(() => clearWorkspaceSuspended());

describe('gateOf', () => {
  it('is null for an account with nothing in its way', () => {
    expect(gateOf(flags({}))).toBeNull();
  });

  it('names the one gate that is closed', () => {
    expect(gateOf(flags({ suspended: true }))).toBe('suspended');
    expect(gateOf(flags({ passwordChangeRequired: true }))).toBe('password');
    expect(gateOf(flags({ mfaEnrolmentRequired: true }))).toBe('mfa');
    expect(gateOf(flags({ emailBlocked: true }))).toBe('email');
  });

  it('does not gate an unverified email that the policy only nags about', () => {
    expect(gateOf(flags({ emailUnverified: true, emailBlocked: false }))).toBeNull();
  });

  it('picks the gate the API would refuse first: suspended, password, two-factor, email', () => {
    const all = {
      suspended: true,
      passwordChangeRequired: true,
      mfaEnrolmentRequired: true,
      emailBlocked: true,
    };
    expect(gateOf(flags(all))).toBe('suspended');
    expect(gateOf(flags({ ...all, suspended: false }))).toBe('password');
    expect(gateOf(flags({ ...all, suspended: false, passwordChangeRequired: false }))).toBe('mfa');
    expect(
      gateOf(
        flags({
          ...all,
          suspended: false,
          passwordChangeRequired: false,
          mfaEnrolmentRequired: false,
        }),
      ),
    ).toBe('email');
  });
});

describe('noteGateError', () => {
  const client = () => {
    const c = new QueryClient();
    return { c, invalidate: jest.spyOn(c, 'invalidateQueries') };
  };

  it.each([
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_PASSWORD_CHANGE_REQUIRED',
    'AUTH_MFA_ENROLMENT_REQUIRED',
    'AUTH_EMAIL_UNVERIFIED',
  ])(
    'reads the session again when %s comes back, so the right lock screen can take over',
    (code) => {
      const { c, invalidate } = client();
      noteGateError(new ApiError(403, code, 'x'), c);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKey });
    },
  );

  it('ignores every other failure', () => {
    const { c, invalidate } = client();
    noteGateError(new ApiError(403, 'RBAC_FORBIDDEN', 'x'), c);
    noteGateError(new ApiError(0, 'CLIENT_NETWORK', 'x'), c);
    noteGateError(new Error('boom'), c);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('remembers a suspended workspace until it is cleared, without reading the session again', async () => {
    const { result } = await renderHook(() => useWorkspaceSuspended());
    expect(result.current).toBe(false);
    const { c, invalidate } = client();
    await act(async () => noteGateError(new ApiError(403, 'WSP_ORG_SUSPENDED', 'x'), c));
    expect(result.current).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => clearWorkspaceSuspended());
    expect(result.current).toBe(false);
  });
});

describe('the app query client', () => {
  it('reads the session again when a read fails because a gate closed', async () => {
    const queryClient = createQueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await expect(
      queryClient.fetchQuery({
        queryKey: ['anything'],
        queryFn: () => Promise.reject(new ApiError(403, 'AUTH_PASSWORD_CHANGE_REQUIRED', 'x')),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: sessionKey });
  });
});
