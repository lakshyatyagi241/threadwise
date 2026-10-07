import type { BillingUsageResponse, V1Me, V1Usage } from '@crm/contracts';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY_MS = 86_400_000;

/**
 * The five meters WaDesk's public API exposes (`PlanUsage::LIMIT_METERS`): its key names and labels, mapped from our plan limit keys.
 * The platform's other limits are not part of WaDesk's public contract and stay off `/me` and `/usage`.
 */
export const V1_METERS: ReadonlyArray<{ key: string; ours: string; label: string }> = [
  { key: 'monthly_messages_limit', ours: 'monthly_messages', label: 'Messages this month' },
  { key: 'contacts_limit', ours: 'contacts', label: 'Contacts' },
  { key: 'device_limit', ours: 'devices', label: 'Connected numbers' },
  { key: 'user_seat_limit', ours: 'users', label: 'Team seats' },
  { key: 'flow_limit', ours: 'flows', label: 'Flows' },
];

/** The cap a meter reports: 0 is "unlimited" on our side and `null` on the wire. */
const cap = (limit: number): number | null => (limit > 0 ? limit : null);

export interface MeBits {
  user: { name: string | null; email: string | null };
  org: { uuid: string; name: string; slug: string; settings: Record<string, unknown> };
  planIsFree: boolean;
  usage: BillingUsageResponse;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function toMe({ user, org, planIsFree, usage }: MeBits): V1Me {
  const limits: Record<string, number | null> = {};
  for (const v of V1_METERS) {
    const m = usage.meters.find((x) => x.key === v.ours);
    limits[v.key] = m ? cap(m.limit) : null;
  }
  const features: Record<string, true> = {};
  for (const f of usage.features) if (f.enabled) features[f.key] = true;
  return {
    account: user,
    workspace: {
      id: org.uuid,
      name: org.name,
      slug: org.slug,
      timezone: text(org.settings.timezone),
      currency: text(org.settings.currency),
    },
    plan: { id: usage.planSlug, name: usage.planName, is_free: planIsFree },
    limits,
    features,
  };
}

export function toUsage(
  usage: BillingUsageResponse,
  wallet: { balanceMinor: number; currency: string },
  now = new Date(),
): V1Usage {
  const resets = new Date(usage.cycleResetsAt);
  const meters: V1Usage['meters'] = {};
  for (const v of V1_METERS) {
    const m = usage.meters.find((x) => x.key === v.ours);
    meters[v.key] = {
      label: v.label,
      used: m?.used ?? 0,
      limit: m ? cap(m.limit) : null,
      unlimited: m ? m.limit <= 0 : true,
      percent: m?.percent ?? null,
    };
  }
  const msg = usage.meters.find((m) => m.key === 'monthly_messages');
  const used = msg?.used ?? 0;
  const limit = msg ? cap(msg.limit) : null;
  const validUntil = usage.validity.planEndsAt ?? usage.validity.trialEndsAt;
  return {
    period: {
      label: `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
      resets_on: usage.cycleResetsAt,
      days_left: Math.max(0, Math.ceil((resets.getTime() - now.getTime()) / DAY_MS)),
    },
    plan: {
      name: usage.planName,
      valid_until: validUntil,
      valid_until_days: usage.validity.daysLeft,
    },
    messages: {
      used,
      limit,
      unlimited: limit === null,
      remaining: limit === null ? null : Math.max(0, limit - used),
      percent: msg?.percent ?? null,
    },
    credits: String(wallet.balanceMinor),
    currency: wallet.currency,
    meters,
  };
}
