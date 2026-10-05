import 'server-only';
import { cookies } from 'next/headers';
import { shellConfigResponseSchema, type ShellConfigResponse } from '@crm/contracts';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

/**
 * What the platform admin chose for the customer shell (mode, rail colours, top bar, tour), or null when it cannot be read:
 * a slow or unreachable API must never take the page down, so the shell then falls back to its plain sidebar.
 */
export async function fetchShellConfig(): Promise<ShellConfigResponse | null> {
  try {
    const at = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!at) return null;
    const res = await fetch(`${apiBase()}/v2/shell/config`, {
      headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const parsed = shellConfigResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
