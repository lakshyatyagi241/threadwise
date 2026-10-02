import 'server-only';
import { cookies } from 'next/headers';
import { planAdminListResponseSchema } from '@crm/contracts';
import { cookieNames } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

/** Rail badge counts by name. A name with no entry has no badge. */
export type ConsoleCounts = Partial<Record<string, number>>;

/**
 * Live counts for the rail. Each source is its own call and fails alone: a count that cannot
 * be read leaves its badge blank and never breaks the page (Reference does the same when a table is missing).
 * Only sources that already exist behind the operator API are used here; a domain adds its count
 * by adding a source and a `BADGE_KEYS` entry in console-nav.ts.
 */
export async function getConsoleCounts(): Promise<ConsoleCounts> {
  const token = (await cookies()).get(cookieNames('operator').access)?.value;
  if (!token) return {};
  const counts: ConsoleCounts = {};

  try {
    const res = await fetch(`${apiBase()}/v2/platform/plans`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const parsed = planAdminListResponseSchema.safeParse(await res.json());
      if (parsed.success) counts.plans = parsed.data.summary.total;
    }
  } catch {
    // network failure: the plans badge stays blank
  }

  return counts;
}
