import { sha256Hex } from './crypto-utils';

/**
 * Every Redis key the auth domain writes, in one place, so a TTL or a prefix
 * is never invented at a call site and a grep finds all users of a key.
 */
export const AuthKeys = {
  /** Tombstone for a revoked session; lives as long as an access token could. */
  revoked: (sid: string) => `auth:rev:${sid}`,
  /** Unix ms of the session's last request. Drives the idle timeout. */
  activity: (sid: string) => `auth:act:${sid}`,
  /** Platform-wide token epoch (WD-AUTH-039). */
  epoch: 'auth:epoch',
  /** Cached account-gate state for one user. */
  gate: (orgId: number, userId: number) => `auth:gate:${orgId}:${userId}`,
  /** Failed-login counter, scoped to org + email + ip. */
  lockout: (orgId: number, email: string, ip: string) =>
    `auth:lock:${orgId}:${sha256Hex(`${email.toLowerCase()}|${ip}`).slice(0, 32)}`,
  /** Per-IP login/signup throttle, across emails. */
  ipThrottle: (scope: string, ip: string) => `auth:ip:${scope}:${ip}`,
  /** MFA step-up challenge, keyed by the hash of the challenge token. */
  mfaChallenge: (token: string) => `auth:mfa:${sha256Hex(token)}`,
  /** Attempts left on an MFA challenge. */
  mfaAttempts: (token: string) => `auth:mfa-try:${sha256Hex(token)}`,
  /**
   * Failed second-factor / password-confirmation attempts for ONE person, across
   * every challenge and every enrol, disable or regenerate call (WD-AUTH-030).
   * A fresh challenge per password login must not reset the guessing budget.
   */
  mfaFailures: (pool: 'user' | 'operator', orgId: number, subjectId: number) =>
    `auth:mfa-fail:${pool}:${orgId}:${subjectId}`,
  /** The session-cap value a session was last checked against (WD-AUTH-034). */
  capChecked: (sid: string) => `auth:cap:${sid}`,
  /** Failed partner-portal sign-ins, scoped away from staff sign-ins for the same address. */
  partnerLockout: (orgId: number, email: string, ip: string) =>
    `auth:lock-partner:${orgId}:${sha256Hex(`${email.toLowerCase()}|${ip}`).slice(0, 32)}`,
  /** Failed sign-ins per IP across emails. Counted on failure only. */
  ipFailures: (scope: string, ip: string) => `auth:ipfail:${scope}:${ip}`,
  /** Pending TOTP enrolment secret (encrypted) for a user. */
  mfaSetup: (orgId: number, subject: string) => `auth:mfa-setup:${orgId}:${subject}`,
  /** Staged sign-up awaiting its WhatsApp code. */
  signup: (challengeId: string) => `auth:signup:${challengeId}`,
  /** Per-number OTP send counter (cost-abuse guard). */
  otpPhone: (e164: string) => `auth:otp-phone:${sha256Hex(e164).slice(0, 24)}`,
  /** Operator "send a test code" counter (5 per hour per operator). */
  otpTest: (operatorId: number) => `auth:otp-test:${operatorId}`,
  /** One worker at a time refreshes the pending OTP template status. */
  otpTemplateRefresh: 'auth:otp-template-refresh',
  /** Social sign-in state (single use). */
  socialState: (state: string) => `auth:social:${sha256Hex(state)}`,
  /** Email-based flows: one mail per address per window. */
  mailThrottle: (kind: string, orgId: number, email: string) =>
    `auth:mail:${kind}:${orgId}:${sha256Hex(email.toLowerCase()).slice(0, 24)}`,
  /** New-device alert dedupe. */
  alertDedupe: (orgId: number, userUuid: string, fp: string) =>
    `auth:alert:${orgId}:${userUuid}:${sha256Hex(fp).slice(0, 16)}`,
  /** Send-guardrail counters (WD-AUTH-041). */
  sendMinute: (orgId: number, stamp: string) => `auth:send-min:${orgId}:${stamp}`,
  sendDay: (orgId: number, stamp: string) => `auth:send-day:${orgId}:${stamp}`,
  /** Operator-facing emergency halt mirror. */
  halt: 'auth:send-halt',
} as const;

export const Ttl = {
  accessRevocationSeconds: 15 * 60 + 60,
  mfaChallengeSeconds: 5 * 60,
  mfaSetupSeconds: 10 * 60,
  mfaMaxAttempts: 5,
  socialStateSeconds: 10 * 60,
  gateSeconds: 30,
  refreshGraceSeconds: 30,
  verifyEmailSeconds: 60 * 60,
  resetPasswordSeconds: 60 * 60,
  emailChangeSeconds: 60 * 60,
  /**
   * Absolute session lifetime when "keep me signed in" is off: seven days, the
   * lifetime WaDesk's session cookie has (SESSION_LIFETIME), so closing the
   * browser tab does not end the session by itself either.
   */
  sessionNoRememberSeconds: 7 * 24 * 60 * 60,
  /** One person's budget of wrong second-factor / confirmation attempts (WD-AUTH-030). */
  mfaFailureWindowSeconds: 15 * 60,
  mfaFailureMax: 5,
} as const;
