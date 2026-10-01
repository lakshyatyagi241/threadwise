export const EVENT_STATUSES = ['success', 'failure', 'warning', 'info'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const parseStatus = (value: string | null | undefined): EventStatus | undefined =>
  (EVENT_STATUSES as readonly string[]).includes(value ?? '') ? (value as EventStatus) : undefined;

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral';
export const statusTone = (status: EventStatus): StatusTone =>
  status === 'success'
    ? 'success'
    : status === 'failure'
      ? 'danger'
      : status === 'warning'
        ? 'warning'
        : 'neutral';

/** The event names the auth module writes; offered as suggestions because the filter matches a name exactly. */
export const KNOWN_EVENTS = [
  'auth.login',
  'auth.failed',
  'auth.lockout',
  'auth.logout',
  'auth.signup',
  'auth.mfa_enabled',
  'auth.mfa_failed',
  'auth.password_changed',
  'auth.password_reset',
  'auth.session_timeout',
  'auth.refresh_reuse_detected',
  'platform.auth.login',
  'platform.auth.failed',
  'platform.auth.lockout',
  'platform.auth.mfa_enabled',
  'platform.auth.mfa_failed',
  'platform.access.blocked_by_ip',
  'platform.security.policy_updated',
  'platform.security.sessions_revoked',
  'platform.security.force_password_reset_all',
  'platform.security.webhook_secrets_rotated',
  'platform.security.emergency_halt_engaged',
  'platform.security.emergency_halt_released',
  'platform.security.danger_action_denied',
  'platform.settings.registration_updated',
  'platform.settings.social_login_updated',
  'platform.settings.auth_pages_updated',
] as const;

/** `/admin/security/events` with only the filters that are set. */
export function eventsHref(filters: { event?: string; status?: EventStatus }): string {
  const p = new URLSearchParams();
  const event = filters.event?.trim();
  if (event) p.set('event', event);
  if (filters.status) p.set('status', filters.status);
  const qs = p.toString();
  return qs ? `/admin/security/events?${qs}` : '/admin/security/events';
}

/** The payload as indented JSON, or null when there is nothing to show. */
export function prettyPayload(payload: Record<string, unknown>): string | null {
  return Object.keys(payload).length === 0 ? null : JSON.stringify(payload, null, 2);
}
