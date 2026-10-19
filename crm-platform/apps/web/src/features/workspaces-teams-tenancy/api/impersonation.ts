import { impersonationStatusSchema, type ImpersonationStatus } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const IMPERSONATION_KEY = ['workspaces-teams-tenancy', 'impersonation'] as const;

/** Where the operator goes if the stop answer does not say: the console's workspace list. */
export const CONSOLE_FALLBACK = '/admin/workspaces';

export const impersonationApi = {
  /** The banner's data: `active: false` for every ordinary session. */
  status: (signal?: AbortSignal): Promise<ImpersonationStatus> =>
    apiFetch('/auth/impersonation', { schema: impersonationStatusSchema, signal }),
};

/**
 * Ends the session through the web app's own route (it must clear the httpOnly cookie, which page code cannot) and answers the
 * path to go to. Never an absolute address: the API names the console, the browser stays on its own host.
 */
export async function stopImpersonation(): Promise<string> {
  const res = await fetch('/api/auth/impersonation/stop', {
    signal: AbortSignal.timeout(30000),
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('stop failed');
  const json = (await res.json().catch(() => null)) as { returnPath?: unknown } | null;
  return typeof json?.returnPath === 'string' && json.returnPath.startsWith('/')
    ? json.returnPath
    : CONSOLE_FALLBACK;
}
