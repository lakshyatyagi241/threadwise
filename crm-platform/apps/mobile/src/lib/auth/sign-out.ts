import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { identifyUser } from '@/lib/observability/sentry';
import { currentRefreshToken, endSession } from './session-manager';

/** Public on the server: it ends the session behind the refresh token even when the access token has expired. */
const revokeSession = (refreshToken: string) =>
  apiFetch('/v2/auth/logout', {
    method: 'POST',
    body: { refreshToken },
    schema: z.object({ ok: z.boolean() }),
    auth: false,
    timeoutMs: 8_000,
  });

/**
 * Ends the session on the server first (best effort, short timeout) and on the phone always. An offline sign-out still signs
 * the person out of the app; the server-side session then lapses on its own, and the refresh token is useless without the phone.
 * The query cache is cleared so the next person to sign in never sees the previous person's data.
 */
export async function signOut(queryClient: QueryClient): Promise<void> {
  const refreshToken = currentRefreshToken();
  if (refreshToken) await revokeSession(refreshToken).catch(() => undefined);
  await endSession();
  identifyUser(null);
  queryClient.clear();
}
