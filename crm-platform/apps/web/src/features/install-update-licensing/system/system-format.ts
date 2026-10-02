import type { SystemCheck, SystemStatusResponse } from '@crm/contracts';

/** 93784 seconds -> "1d 2h 3m". Seconds only appear below a minute. */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export const checkTone = (status: SystemCheck['status']): Tone =>
  status === 'up' ? 'success' : status === 'degraded' ? 'warning' : 'danger';

export const migrationStatusTone = (status: SystemStatusResponse['migrations']['status']): Tone =>
  status === 'current'
    ? 'success'
    : status === 'unknown'
      ? 'neutral'
      : status === 'pending'
        ? 'warning'
        : 'danger';

export const rowTone = (
  state: SystemStatusResponse['migrations']['rows'][number]['state'],
): Tone => (state === 'applied' ? 'success' : state === 'pending' ? 'warning' : 'danger');
