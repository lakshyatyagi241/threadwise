import type { WorkspaceHubRow } from '@crm/contracts';

export type EndsTone = 'danger' | 'warning' | 'neutral';

const DAY_MS = 86_400_000;

/**
 * The date a workspace's current period ends: the trial end while it is on trial, else the plan end.
 * `days` is whole days (rounded up, never below 1 while the date is ahead) or null when there is no date;
 * a date in the past is `expired`.
 */
export function endsInfo(
  validity: WorkspaceHubRow['validity'],
  now: number = Date.now(),
): { iso: string | null; days: number | null; expired: boolean; tone: EndsTone } {
  const iso = validity.state === 'free_trial' ? validity.trialEndsAt : validity.planEndsAt;
  if (!iso) return { iso: null, days: null, expired: false, tone: 'neutral' };
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return { iso, days: 0, expired: true, tone: 'danger' };
  const days = Math.max(1, Math.ceil(diff / DAY_MS));
  return {
    iso,
    days,
    expired: false,
    tone: days <= 3 ? 'danger' : days <= 7 ? 'warning' : 'neutral',
  };
}

/** How long ago, in the coarsest whole unit. */
export function agoParts(
  iso: string,
  now: number = Date.now(),
): { unit: 'now' | 'minutes' | 'hours' | 'days'; count: number } {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return { unit: 'now', count: 0 };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}

/** A cap for the compact limits cell: the number, or the infinity sign for "no cap". */
export const capText = (n: number | null, locale: string): string =>
  n === null ? '∞' : new Intl.NumberFormat(locale).format(n);

/** Minor units arrive as a decimal string; the amount is shown in the wallet's own currency, never converted. */
export function formatWalletBalance(minor: string, currency: string, locale: string): string {
  const major = Number(minor) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

/** MRR is a decimal string in the platform base currency; without the currency (the detail has none) it is shown as a plain amount. */
export function formatMrr(amount: string, currency: string | null, locale: string): string {
  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}
