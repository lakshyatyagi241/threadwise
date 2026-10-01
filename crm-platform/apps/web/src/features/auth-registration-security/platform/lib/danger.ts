import type { DangerActionResponse } from '@crm/contracts';

export type DangerKind = DangerActionResponse['action'];

export interface DangerSpec {
  kind: DangerKind;
  /** Operator API path, relative to `/v2/platform`. */
  path: string;
  /** What the operator must type to confirm. Plain words, compared without regard to case. */
  phrase: string;
}

export const DANGER_ACTIONS: Record<DangerKind, DangerSpec> = {
  revoke_sessions: {
    kind: 'revoke_sessions',
    path: '/security/danger/revoke-sessions',
    phrase: 'revoke sessions',
  },
  force_password_reset: {
    kind: 'force_password_reset',
    path: '/security/danger/force-password-reset',
    phrase: 'force reset',
  },
  rotate_webhook_secrets: {
    kind: 'rotate_webhook_secrets',
    path: '/security/danger/rotate-webhook-secrets',
    phrase: 'rotate secrets',
  },
  halt_sends: { kind: 'halt_sends', path: '/security/danger/halt-sends', phrase: 'halt sends' },
  resume_sends: {
    kind: 'resume_sends',
    path: '/security/danger/resume-sends',
    phrase: 'resume sends',
  },
};

/** Typed confirmation: trimmed, whitespace collapsed, case ignored. */
export function phraseMatches(typed: string, phrase: string): boolean {
  const clean = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return clean(typed) === clean(phrase);
}

/** Revoking every session also ends the caller's own, so the page must not make another request afterwards. */
export const endsCallersSession = (kind: DangerKind): boolean => kind === 'revoke_sessions';
