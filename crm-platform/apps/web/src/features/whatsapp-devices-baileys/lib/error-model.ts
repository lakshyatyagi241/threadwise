import { ApiError } from '@/lib/api/errors';

export interface DescribedError {
  /** Message key under `whatsapp-devices-baileys.errors`. */
  key: string;
  values: Record<string, string | number>;
  requestId?: string;
  /** The plan or the cap refused: the screen adds the upgrade pointer. */
  plan: boolean;
  /** The stable code, for the screen to branch on (for example `DEVICE_NOT_PAIRABLE` offers "link from scratch"). */
  code?: string;
  /** Seconds the server asks the caller to wait, when it said so. */
  retryAfterS?: number;
  /** A pairing refused only because a saved session or an attempt exists: starting with `relink: true` is allowed. */
  relinkable?: boolean;
  fieldErrors: Array<{ path: string; message: string }>;
}

const detail = (e: ApiError, ...paths: string[]): string | undefined =>
  e.fieldErrors.find((f) => paths.includes(f.path))?.message;

const positiveInt = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
};

/**
 * What a failed call means for this feature, by the stable `code` only (never by the message text, never shown raw). `known`
 * lists the codes `errors.<code>` has words for. A code with no words reads as the generic error.
 */
export function describeError(e: unknown, known: (code: string) => boolean): DescribedError {
  if (!(e instanceof ApiError)) return { key: 'generic', values: {}, plan: false, fieldErrors: [] };
  const base = { requestId: e.requestId, fieldErrors: e.fieldErrors, code: e.code } as const;
  const retryAfterS = positiveInt(detail(e, 'retryAfterS', 'retryAfterSeconds'));

  switch (e.code) {
    case 'PLAN_LIMIT_REACHED': {
      // The plan guard names the meter in `limit` and the number in `limitValue`.
      const limit = positiveInt(detail(e, 'limitValue'));
      return {
        ...base,
        key: limit ? 'PLAN_LIMIT_REACHED' : 'PLAN_LIMIT_REACHED_GENERIC',
        values: limit ? { limit } : {},
        plan: true,
      };
    }
    case 'DEVICE_NOT_PAIRABLE': {
      // `reason` says why: a connected number must be disconnected first; a saved session or a running attempt can be forgotten.
      const why = detail(e, 'reason');
      const key =
        why === 'connected'
          ? 'DEVICE_NOT_PAIRABLE_CONNECTED'
          : why === 'healthy_session'
            ? 'DEVICE_NOT_PAIRABLE_SESSION'
            : why === 'live_state'
              ? 'DEVICE_NOT_PAIRABLE_LIVE'
              : 'DEVICE_NOT_PAIRABLE';
      return {
        ...base,
        key,
        values: {},
        plan: false,
        relinkable: why === 'healthy_session' || why === 'live_state',
      };
    }
    case 'DEVICE_PILOT_CAP_REACHED':
      return { ...base, key: e.code, values: {}, plan: false };
    case 'DEVICE_PAIRING_RATE_LIMITED':
    case 'DEVICE_CREATE_RATE_LIMITED':
      return retryAfterS
        ? {
            ...base,
            key: `${e.code}_WAIT`,
            values: { minutes: Math.max(1, Math.ceil(retryAfterS / 60)) },
            plan: false,
            retryAfterS,
          }
        : { ...base, key: e.code, values: {}, plan: false };
    case 'DEVICE_PAIRING_IN_PROGRESS': {
      const name = detail(e, 'startedBy');
      return name
        ? {
            ...base,
            key: 'DEVICE_PAIRING_IN_PROGRESS_BY',
            values: { name },
            plan: false,
            retryAfterS,
          }
        : { ...base, key: e.code, values: {}, plan: false, retryAfterS };
    }
    default:
      return {
        ...base,
        key: known(e.code) ? e.code : 'generic',
        values: {},
        plan: e.code === 'PLAN_FEATURE_LOCKED',
        retryAfterS,
      };
  }
}
