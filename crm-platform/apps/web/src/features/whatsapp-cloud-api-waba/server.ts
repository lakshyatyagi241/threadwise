import 'server-only';
import { cookies } from 'next/headers';
import { wabaConnectionListSchema } from '@crm/contracts';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';
import { WABA_CHANNEL } from './lib/channels';

/**
 * The channels the workspace has CONNECTED, for the menu's `gates.channel` (Reference drops "Meta Groups" unless a WhatsApp Business number
 * is connected). A set of keys, or null when it cannot be known (not signed in, the person may not list numbers, the API is slow): unknown
 * removes nothing, so a failed lookup never hides a screen.
 *
 * Today this fills only `waba`. A menu entry gated on another channel key must add its source here, otherwise it would be removed.
 */
export async function fetchConnectedChannels(
  canListNumbers: boolean,
): Promise<ReadonlySet<string> | null> {
  if (!canListNumbers) return null;
  try {
    const at = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!at) return null;
    const res = await fetch(`${apiBase()}/v2/waba/numbers`, {
      headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const parsed = wabaConnectionListSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return new Set(parsed.data.items.some((c) => c.status === 'connected') ? [WABA_CHANNEL] : []);
  } catch {
    return null;
  }
}
