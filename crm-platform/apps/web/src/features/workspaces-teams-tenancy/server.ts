import 'server-only';
import { wspInvitePreviewSchema, type WspInvitePreview } from '@crm/contracts';
import { apiBase } from '@/lib/auth/server';

/**
 * What the accept-invite page shows before the invitee types anything: the workspace, the role and who invited them.
 * Null when the link is unknown, used, expired or the API cannot be reached: the page then says the link no longer works.
 */
export async function loadInvitePreview(
  token: string,
  orgSlug: string,
): Promise<WspInvitePreview | null> {
  try {
    const url = new URL(`${apiBase()}/v2/workspace/invitations/preview`);
    url.searchParams.set('token', token);
    url.searchParams.set('orgSlug', orgSlug);
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const parsed = wspInvitePreviewSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
