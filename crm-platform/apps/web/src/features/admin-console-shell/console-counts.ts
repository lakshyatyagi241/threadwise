import 'server-only';
import { cookies } from 'next/headers';
import {
  announcementListResponseSchema,
  couponListResponseSchema,
  guidebookAdminListResponseSchema,
  planAdminListResponseSchema,
  nodeBridgeResponseSchema,
  platformRoleListResponseSchema,
} from '@crm/contracts';
import { cookieNames } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

/** Rail badge counts by name. A name with no entry has no badge. */
export type ConsoleCounts = Partial<Record<string, number>>;

/**
 * Live counts for the rail. Each source is its own call and fails alone: a count that cannot
 * be read leaves its badge blank and never breaks the page (WaDesk does the same when a table is missing).
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

  // Roles and permissions: one call carries both totals (WaDesk's sidebar badges are raw row counts). An operator without
  // platform.role.manage gets a 403 here and simply sees no badge.
  try {
    const res = await fetch(`${apiBase()}/v2/platform/roles`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const parsed = platformRoleListResponseSchema.safeParse(await res.json());
      if (parsed.success) {
        counts.roles = parsed.data.kpis.totalRoles;
        counts.permissions = parsed.data.kpis.totalPermissions;
      }
    }
  } catch {
    // network failure: the badges stay blank
  }

  // Coupons: the badge counts ACTIVE coupons only, whatever their expiry (WD-CPN-001 rule 3).
  try {
    const res = await fetch(`${apiBase()}/v2/platform/coupons`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const parsed = couponListResponseSchema.safeParse(await res.json());
      if (parsed.success) counts.coupons = parsed.data.summary.active;
    }
  } catch {
    // network failure: the coupons badge stays blank
  }

  // Marketing: announcements switched on (whatever their window) and published guidebook articles, as WaDesk's badges.
  try {
    const [a, g] = await Promise.all([
      fetch(`${apiBase()}/v2/platform/cms/announcements?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
      fetch(`${apiBase()}/v2/platform/cms/guidebook?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ]);
    if (a.ok) {
      const parsed = announcementListResponseSchema.safeParse(await a.json());
      if (parsed.success) counts.announcements = parsed.data.summary.switchedOn;
    }
    if (g.ok) {
      const parsed = guidebookAdminListResponseSchema.safeParse(await g.json());
      if (parsed.success) counts.guidebook = parsed.data.summary.published;
    }
  } catch {
    // network failure: the marketing badges stay blank
  }

  // The unofficial WhatsApp switch: the Node bridge entry says "Not supported" while it is off. `unofficialOff` is a flag, not a count;
  // an operator who cannot read the bridge settings, or an API without the field, simply sees no badge.
  try {
    const res = await fetch(`${apiBase()}/v2/platform/node-bridge`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.ok) {
      const parsed = nodeBridgeResponseSchema.safeParse(await res.json());
      if (parsed.success && !parsed.data.unofficialEnabled) counts.unofficialOff = 1;
    }
  } catch {
    // network failure: the node bridge badge stays blank
  }

  return counts;
}
