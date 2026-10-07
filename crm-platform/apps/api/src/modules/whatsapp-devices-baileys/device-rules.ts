import {
  HEALTHY_SESSION_ROWS,
  PAIRABLE_STATES,
  PERSONAL_WA_NOTICE_VERSION,
  type DeviceConnectionState,
  type PairingMethod,
} from '@crm/contracts';

/**
 * The pure rules of the personal-number devices API (docs/specs/personal-whatsapp-connect.md sections 8 to 10). Nothing here touches a
 * database or Redis, so each rule can be read and tested on its own.
 */

// --- limits (named, so an operator or a later setting can move them) --------------------------------------------------------------

/**
 * Pilot cap (owner decision D3): personal numbers per workspace whatever the plan says. The plan's `devices` limit still applies when it
 * is lower; a plan limit of 0 ("unlimited") is NOT honoured for this engine while the pilot cap is set.
 */
export const PILOT_DEVICE_CAP = 2;

/** Pairing starts (QR or code) per device per hour: many starts in a short time look like automation to WhatsApp (spec 10.3). */
export const PAIRING_STARTS_PER_DEVICE_PER_HOUR = 5;
/** Pairing starts per workspace per day. */
export const PAIRING_STARTS_PER_ORG_PER_DAY = 20;
/** Devices created per workspace per hour: prevents a loop of rows. */
export const DEVICE_CREATES_PER_ORG_PER_HOUR = 10;

export const HOUR_S = 3_600;
export const DAY_S = 86_400;

/** A QR that nobody scanned is abandoned by the runtime 90 s after the first one (WD-NODE-011 rule 5). */
export const QR_DEADLINE_MS = 90_000;
/** A pairing code is valid for 3 minutes. */
export const CODE_DEADLINE_MS = 180_000;

export const deadlineMs = (method: PairingMethod): number =>
  method === 'qr' ? QR_DEADLINE_MS : CODE_DEADLINE_MS;

// --- the cap -----------------------------------------------------------------------------------------------------------------

/** The cap that applies to personal numbers: the smaller of the plan's limit (0 = unlimited) and the pilot cap. */
export function effectiveDeviceCap(planLimit: number, pilotCap: number = PILOT_DEVICE_CAP): number {
  if (planLimit <= 0) return pilotCap;
  return Math.min(planLimit, pilotCap);
}

// --- the number --------------------------------------------------------------------------------------------------------------

const digitsOf = (s: string): string => s.replace(/\D+/g, '');

export interface SplitPhone {
  /** `+91`. */
  countryCode: string;
  /** The local number, digits only (a repeated country code stripped when 9 or more digits remain). */
  phone: string;
  /** Country code and local number, digits only: the key of the unique index and what the runtime links against. */
  digits: string;
}

/**
 * WaDesk's `splitPhone` (WD-WADEV-005 rule 1): strip every non-digit from both fields; when the local part starts with the country
 * code AND removing it still leaves at least 9 digits, strip that prefix once. So `+91` with `+91 7690059356` gives `91` and
 * `7690059356`, while a 10-digit Indian number that happens to begin with `91` is left intact. Null when either part has no digits.
 */
export function splitDevicePhone(countryCode: string, phone: string): SplitPhone | null {
  const cc = digitsOf(countryCode);
  let local = digitsOf(phone);
  if (cc === '' || local === '') return null;
  if (local.startsWith(cc) && local.length - cc.length >= 9) local = local.slice(cc.length);
  return { countryCode: `+${cc}`, phone: local, digits: `${cc}${local}` };
}

/** WaDesk's region guess from the dial code when the region is left blank (India, US, UK, UAE, Germany, Italy, Korea, Nigeria, else XX). */
export function guessRegion(countryCode: string): string {
  switch (digitsOf(countryCode)) {
    case '91':
      return 'IN';
    case '1':
      return 'US';
    case '44':
      return 'GB';
    case '971':
      return 'AE';
    case '49':
      return 'DE';
    case '39':
      return 'IT';
    case '82':
      return 'KR';
    case '234':
      return 'NG';
    default:
      return 'XX';
  }
}

/** `+` and the digits. */
export const toE164 = (digits: string): string => `+${digits}`;

// --- pairing -----------------------------------------------------------------------------------------------------------------

export type PairingRefusal = 'connected' | 'healthy_session' | 'live_state';

/**
 * May a pairing start now (spec 8.2 and R1)? A pairing wipes the saved session first, so it starts only from `created`,
 * `disconnected`, `logged_out` or `error` WITH FEWER than 3 saved session rows; from any other state, or with a healthy saved session,
 * only when the caller says `relink` ("forget the saved session"). A connected device is never re-paired: disconnect it first.
 * Returns null when it may start, else why not.
 */
export function pairingRefusal(i: {
  state: DeviceConnectionState;
  sessionRows: number;
  relink: boolean;
}): PairingRefusal | null {
  if (i.state === 'connected') return 'connected';
  if (i.relink) return null;
  if (!PAIRABLE_STATES.includes(i.state)) return 'live_state';
  if (i.sessionRows >= HEALTHY_SESSION_ROWS) return 'healthy_session';
  return null;
}

/** The states in which a pairing attempt may still be running. */
export const LIVE_PAIRING_STATES: readonly DeviceConnectionState[] = [
  'awaiting_qr',
  'awaiting_pairing_code',
  'connecting',
];

export interface AttemptRecord {
  attempt: string;
  method: PairingMethod;
  startedByUserId: number;
  startedAt: number;
  deadlineAt: number;
}

/** Whether a recorded attempt is still running and belongs to somebody else (a second person's start is refused, spec 7.3). */
export function blockedByOtherAttempt(i: {
  attempt: AttemptRecord | null;
  state: DeviceConnectionState;
  userId: number;
  now: number;
}): boolean {
  const a = i.attempt;
  if (!a) return false;
  return (
    a.startedByUserId !== i.userId && i.now < a.deadlineAt && LIVE_PAIRING_STATES.includes(i.state)
  );
}

// --- the risk notice ---------------------------------------------------------------------------------------------------------

/** An acknowledgement counts only for the CURRENT version of the notice (a bump asks everybody again, spec 6.3). */
export const isCurrentNotice = (version: string): boolean => version === PERSONAL_WA_NOTICE_VERSION;

// --- windows -----------------------------------------------------------------------------------------------------------------

/** What a fixed-window counter answers: allowed while `count <= limit`; `retryAfterS` is what is left of the window. */
export function windowVerdict(
  count: number,
  limit: number,
  ttlS: number,
  windowS: number,
): { allowed: boolean; retryAfterS: number } {
  return { allowed: count <= limit, retryAfterS: ttlS > 0 ? ttlS : windowS };
}
