import type {
  CallingCheck,
  CallingMetaReason,
  CallingCheckCode,
  CallingCheckKey,
  CallingCheckState,
  CallingReadinessStatus,
  IceServer,
} from '@crm/contracts';

/**
 * The rules of the calling readiness checklist (EXT-CALL-007, 008): facts in, one row per prerequisite out, as codes the web translates.
 * No database, no network, no clock but the one passed in, so every outcome of every row is a plain unit test.
 */

/** Meta's daily messaging limit a number needs before calling can be switched on (the prerequisite Meta names). */
export const CALLING_MIN_MESSAGING_LIMIT = 2_000;

/** Messaging tiers at or above the minimum; `TIER_UNLIMITED` and Meta's `UNLIMITED` both mean no cap. */
const TIER_VALUES: Readonly<Record<string, number>> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.POSITIVE_INFINITY,
  UNLIMITED: Number.POSITIVE_INFINITY,
};

/** Both scopes the stored token needs: one to change the number's calling settings, one to message and call. */
export const CALLING_REQUIRED_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
] as const;

/** A token that runs out inside this window is a warning: calling would stop working without anyone changing anything. */
const TOKEN_WARN_DAYS = 7;

export interface PhoneFacts {
  /** Meta's `status` of the number (`CONNECTED` when it is live on the Cloud API). */
  status: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  accountMode: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
}

export type TokenFacts =
  | { kind: 'none' }
  | { kind: 'unverifiable' }
  | { kind: 'invalid' }
  | { kind: 'inspected'; scopes: string[]; expiresAt: Date | null; appId: string | null };

export type CallsFieldFacts = 'present' | 'added' | 'missing' | 'unverifiable';

export interface ReadinessFacts {
  planEnabled: boolean;
  /** The number's connection: `connected` status and credentials Meta can be asked with. */
  connection: 'ok' | 'not_connected' | 'no_credentials';
  /** The local record already says the line is shared with the WhatsApp Business app. */
  coexistenceLocal: boolean;
  /** The live read of the phone; `null` when Meta could not be read. */
  phone: PhoneFacts | null;
  token: TokenFacts;
  /** Apps subscribed to the WABA; `null` when it could not be read. */
  subscribedApps: number | null;
  callsField: CallsFieldFacts;
  /** Meta's calling settings; `null` when they could not be read. */
  calling: { status: 'ENABLED' | 'DISABLED' | null; callIconVisibility: string | null } | null;
  /** The operator's `CALLING_ICE_SERVERS`: whether any text was set, and what of it fits. */
  ice: { configured: boolean; servers: IceServer[] };
  /** People of the workspace who may place and answer calls (`call.calls.use`). */
  diallers: number;
  recording: { enabled: boolean; hasNotice: boolean };
}

const check = (
  key: CallingCheckKey,
  state: CallingCheckState,
  code: CallingCheckCode,
  params?: CallingCheck['params'],
): CallingCheck => (params ? { key, state, code, params } : { key, state, code });

/** The messaging limit of a tier, `null` when the tier is not one this code knows (Meta adds tiers). */
export function tierValue(tier: string | null | undefined): number | null {
  const v = TIER_VALUES[(tier ?? '').toUpperCase()];
  return v === undefined ? null : v;
}

export const isCoexistencePlatform = (platformType: string | null | undefined): boolean => {
  const t = (platformType ?? '').toUpperCase();
  return t === 'COEXISTENCE' || t === 'SMB_APP';
};

const isTurnUrl = (u: string): boolean => /^turns?:/i.test(u.trim());
const urlsOf = (s: IceServer): string[] => (Array.isArray(s.urls) ? s.urls : [s.urls]);

/** Whether the ICE list has a TURN relay with the credentials a relay needs; a list that fits nothing is its own finding. */
export function turnCheck(ice: ReadinessFacts['ice']): CallingCheck {
  if (ice.configured && ice.servers.length === 0) return check('turn', 'warn', 'ice_invalid');
  const turn = ice.servers.filter((s) => urlsOf(s).some(isTurnUrl));
  if (turn.length === 0) return check('turn', 'warn', 'turn_missing');
  if (turn.some((s) => !s.username || !s.credential)) {
    return check('turn', 'warn', 'turn_incomplete');
  }
  return check('turn', 'ok', 'turn_ok', { servers: turn.length });
}

function scopesCheck(token: TokenFacts, now: Date): CallingCheck {
  switch (token.kind) {
    case 'none':
      // A number reached through a provider keeps no token of its own: the provider holds the permissions.
      return check('token_scopes', 'warn', 'scopes_unverifiable');
    case 'unverifiable':
      return check('token_scopes', 'warn', 'scopes_unverifiable');
    case 'invalid':
      return check('token_scopes', 'fail', 'token_invalid');
    case 'inspected': {
      const missing = CALLING_REQUIRED_SCOPES.filter((s) => !token.scopes.includes(s));
      if (missing.length > 0) {
        return check('token_scopes', 'fail', 'scope_missing', { missing: missing.join(', ') });
      }
      if (token.expiresAt) {
        const days = Math.ceil((token.expiresAt.getTime() - now.getTime()) / 86_400_000);
        if (days <= 0) return check('token_scopes', 'fail', 'token_invalid');
        if (days <= TOKEN_WARN_DAYS)
          return check('token_scopes', 'warn', 'token_expiring', { days });
      }
      return check('token_scopes', 'ok', 'scopes_ok');
    }
  }
}

function registeredCheck(phone: PhoneFacts | null): CallingCheck {
  if (!phone) return check('number_registered', 'warn', 'meta_unreadable');
  if ((phone.codeVerificationStatus ?? '').toUpperCase() === 'NOT_VERIFIED') {
    return check('number_registered', 'fail', 'number_not_verified');
  }
  const status = (phone.status ?? '').toUpperCase();
  // Anything but CONNECTED (PENDING, DELETED, FLAGGED, RESTRICTED, MIGRATED, ...) is a number Meta will not run calls on.
  if (status !== '' && status !== 'CONNECTED') {
    return check('number_registered', 'fail', 'number_not_live', { status });
  }
  return check('number_registered', 'ok', 'number_ok');
}

function limitCheck(phone: PhoneFacts | null): CallingCheck {
  if (!phone) return check('messaging_limit', 'warn', 'meta_unreadable');
  // A test number (Meta's sandbox) is exempt from the limit.
  if ((phone.accountMode ?? '').toUpperCase() === 'SANDBOX') {
    return check('messaging_limit', 'ok', 'limit_test_number');
  }
  const value = tierValue(phone.messagingLimitTier);
  if (value === null) return check('messaging_limit', 'warn', 'limit_unknown');
  if (value < CALLING_MIN_MESSAGING_LIMIT) {
    return check('messaging_limit', 'fail', 'limit_low', {
      tier: phone.messagingLimitTier ?? '',
      needed: CALLING_MIN_MESSAGING_LIMIT,
    });
  }
  if ((phone.qualityRating ?? '').toUpperCase() === 'RED') {
    return check('messaging_limit', 'warn', 'quality_low');
  }
  return check('messaging_limit', 'ok', 'limit_ok');
}

function callingCheck(f: ReadinessFacts, refusal: CallingMetaReason | null): CallingCheck {
  // No status in Meta's answer is not a pass: only what Meta said counts, never the local flag.
  if (!f.calling || f.calling.status === null) {
    return check('calling_enabled', 'warn', 'meta_unreadable');
  }
  if (f.calling.status !== 'ENABLED') {
    // `refused`: Meta turned down a switch-on attempt a moment ago; the card says why in words.
    return refusal
      ? check('calling_enabled', 'fail', 'calling_off', { refused: refusal })
      : check('calling_enabled', 'fail', 'calling_off');
  }
  if ((f.calling.callIconVisibility ?? '').toUpperCase() === 'DISABLE_ALL') {
    return check('calling_enabled', 'warn', 'icon_hidden');
  }
  return check('calling_enabled', 'ok', 'calling_on');
}

const META_ROWS: readonly CallingCheckKey[] = [
  'number_registered',
  'messaging_limit',
  'token_scopes',
  'webhook_subscribed',
  'calls_field',
  'calling_enabled',
];

/**
 * The checklist, one row per key in `CALLING_CHECK_KEYS` order. A workspace without the plan feature gets `plan_missing` and nothing
 * else is looked at; a number that is not connected skips the rows that need Meta. A skipped row is `not_checked` (a warning that says
 * "fix the row above first"), never an `ok`.
 */
export function buildChecks(
  f: ReadinessFacts,
  now: Date,
  refusal: CallingMetaReason | null = null,
): CallingCheck[] {
  if (!f.planEnabled) {
    return [
      check('plan_feature', 'fail', 'plan_missing'),
      ...(
        [
          'connection',
          'not_coexistence',
          ...META_ROWS,
          'turn',
          'dialler_permissions',
          'recording_consent',
        ] as CallingCheckKey[]
      ).map((k) => check(k, 'warn', 'not_checked')),
    ];
  }

  const connected = f.connection === 'ok';
  const skipped = (key: CallingCheckKey): CallingCheck => check(key, 'warn', 'not_checked');

  // A row that says "fine" must have looked: with Meta unread or the number not connected, only a local record can say anything.
  const coexistence = f.coexistenceLocal
    ? check('not_coexistence', 'fail', 'coexistence')
    : !connected
      ? skipped('not_coexistence')
      : !f.phone
        ? check('not_coexistence', 'warn', 'meta_unreadable')
        : isCoexistencePlatform(f.phone.platformType)
          ? check('not_coexistence', 'fail', 'coexistence')
          : (f.phone.platformType ?? '').toUpperCase() === 'ON_PREMISE'
            ? check('not_coexistence', 'fail', 'on_premise')
            : check('not_coexistence', 'ok', 'cloud_api_only');

  const rows: CallingCheck[] = [
    check('plan_feature', 'ok', 'plan_ok'),
    f.connection === 'ok'
      ? check('connection', 'ok', 'connected')
      : check(
          'connection',
          'fail',
          f.connection === 'no_credentials' ? 'no_credentials' : 'not_connected',
        ),
    coexistence,
    connected ? registeredCheck(f.phone) : skipped('number_registered'),
    connected ? limitCheck(f.phone) : skipped('messaging_limit'),
    connected ? scopesCheck(f.token, now) : skipped('token_scopes'),
    connected
      ? f.subscribedApps === null
        ? check('webhook_subscribed', 'warn', 'meta_unreadable')
        : f.subscribedApps > 0
          ? check('webhook_subscribed', 'ok', 'subscribed_ok')
          : check('webhook_subscribed', 'fail', 'waba_not_subscribed')
      : skipped('webhook_subscribed'),
    connected ? callsFieldCheck(f.callsField) : skipped('calls_field'),
    connected ? callingCheck(f, refusal) : skipped('calling_enabled'),
    turnCheck(f.ice),
    f.diallers > 0
      ? check('dialler_permissions', 'ok', 'dialler_ok', { people: f.diallers })
      : check('dialler_permissions', 'fail', 'dialler_none'),
    !f.recording.enabled
      ? check('recording_consent', 'ok', 'recording_off')
      : f.recording.hasNotice
        ? check('recording_consent', 'ok', 'recording_configured')
        : check('recording_consent', 'warn', 'recording_notice_missing'),
  ];
  return rows;
}

function callsFieldCheck(state: CallsFieldFacts): CallingCheck {
  switch (state) {
    case 'present':
      return check('calls_field', 'ok', 'calls_field_ok');
    case 'added':
      return check('calls_field', 'ok', 'calls_field_added');
    case 'missing':
      return check('calls_field', 'fail', 'calls_field_missing');
    case 'unverifiable':
      return check('calls_field', 'warn', 'calls_field_unverifiable');
  }
}

/**
 * Where the number stands. "Calling is off" is the one fail that is the point of the page, not a blocker: with every other row fine
 * the number is `ready_to_enable`. Any other fail is `blocked`.
 */
export function deriveStatus(checks: readonly CallingCheck[]): CallingReadinessStatus {
  if (checks.length === 0) return 'never_checked';
  const blockers = checks.filter((c) => c.state === 'fail' && c.code !== 'calling_off');
  if (blockers.length > 0) return 'blocked';
  if (checks.some((c) => c.code === 'calling_off')) return 'ready_to_enable';
  return checks.some((c) => c.state === 'warn') ? 'attention' : 'ready';
}

/** The rows that keep calling from working at all, for a toggle-on that should be refused or an automatic enable that should wait. */
export function blockers(checks: readonly CallingCheck[]): CallingCheck[] {
  return checks.filter((c) => c.state === 'fail' && c.code !== 'calling_off');
}

/**
 * Whether a number may be switched on by itself: nothing fails AND everything that can fail was actually read. A row that could not be
 * read (`meta_unreadable`) or waited on another (`not_checked`) is not a pass, so an automatic switch-on waits for the next check.
 */
export function readyForAutoEnable(checks: readonly CallingCheck[]): boolean {
  return (
    blockers(checks).length === 0 &&
    !checks.some((c) => c.code === 'meta_unreadable' || c.code === 'not_checked')
  );
}

const MINUTE = 60_000;

/**
 * When the schedule looks at a number again: soon after a number that is not ready (so a fix is noticed), later for one that is.
 */
export function nextCheckAt(status: CallingReadinessStatus, now: Date): Date {
  const minutes: Record<CallingReadinessStatus, number> = {
    never_checked: 15,
    blocked: 30,
    ready_to_enable: 6 * 60,
    attention: 3 * 60,
    ready: 6 * 60,
  };
  return new Date(now.getTime() + minutes[status] * MINUTE);
}
