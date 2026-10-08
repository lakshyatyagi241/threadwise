import { WabaApiError } from './waba-errors';

/**
 * Meta's Groups API errors, mapped once (docs/specs/waba-groups-management.md 3.5 and 10). Nothing above the adapter reads a 131xxx
 * number: the API turns `kind` into a stable problem+json code, and the operator sentence is shown as is.
 *
 * The 15 operator sentences are Reference's `GroupClient::ERROR_TEXT` and come from the reference only: Meta's reference page did not list
 * them when the spec was written, so they are not re-verified against Meta (spec 0 and 21).
 */

/** Meta answered that the number can never use Groups. Only this code is a definite "no" for eligibility. */
export const GROUP_ERR_NOT_ELIGIBLE = 131215;
/** The group is gone, or this number is not a member of it. */
export const GROUP_ERR_GONE = 131041;
export const GROUP_ERR_SUSPENDED = 131207;
export const GROUP_ERR_RATE_LIMITED = 131208;

export const GROUP_ERROR_TEXT: Readonly<Record<number, string>> = {
  131020: 'A group needs more than one member before you can message it.',
  131041: 'That group no longer exists, or this number is not a member of it.',
  131059: 'The page cursor expired. Reload the list and try again.',
  131201: 'Some participants in the request could not be processed.',
  131202: 'The same participant was listed more than once.',
  131204: 'The group is at its participant limit.',
  131207: 'Meta has suspended this group for a policy violation.',
  131208: 'Too many group operations from this number. Wait a moment and retry.',
  131209: 'The group picture must be square.',
  131210: 'The group picture must be at least 192 by 192 pixels.',
  131211: 'This number has reached its limit for created groups.',
  131212: 'That person is not a member of the group.',
  131213: 'That join request no longer exists.',
  131214: 'Meta has temporarily disabled group creation for this number.',
  131215:
    'This number is not eligible for the Groups API. Meta requires an Official Business Account.',
};

export type GroupFailureKind =
  | 'not_eligible'
  | 'not_found'
  | 'suspended'
  | 'limit_reached'
  | 'rate_limited'
  | 'unavailable'
  | 'rejected';

export interface GroupFailure {
  kind: GroupFailureKind;
  /** Operator wording: ours for the 15 codes, Meta's message otherwise, `HTTP <status>` as the last resort. */
  message: string;
  metaCode: number | null;
  /** The call did not get a real answer from Meta (network, 5xx): safe to try the same call again. */
  transient: boolean;
}

/** What went wrong on a Groups call, as one value. Never throws. */
export function describeGroupFailure(err: WabaApiError): GroupFailure {
  const code = err.code;
  const own = code !== null ? GROUP_ERROR_TEXT[code] : undefined;
  const message =
    own ??
    // `err.message` already carries "(code N, trace X)"; the operator gets Meta's own sentence without the trace (Reference: `error.message`).
    (err.status === 0
      ? err.message
      : (metaMessageOf(err) ?? err.userMessage ?? `HTTP ${err.status}`));
  const kindOf = (): GroupFailureKind => {
    if (code === GROUP_ERR_NOT_ELIGIBLE) return 'not_eligible';
    if (code === GROUP_ERR_GONE) return 'not_found';
    if (code === GROUP_ERR_SUSPENDED) return 'suspended';
    if (code === 131204 || code === 131211) return 'limit_reached';
    if (code === GROUP_ERR_RATE_LIMITED || code === 130429 || code === 80007 || err.status === 429)
      return 'rate_limited';
    // A real answer from Meta with a group code is a rejection, even when Meta flags it transient.
    if (code !== null && own) return 'rejected';
    if (err.retryable) return 'unavailable';
    return 'rejected';
  };
  const kind = kindOf();
  return {
    kind,
    message,
    metaCode: code,
    transient: kind === 'unavailable',
  };
}

function metaMessageOf(err: WabaApiError): string | null {
  const body = err.body as { error?: { message?: unknown } } | null;
  const m = body?.error?.message;
  return typeof m === 'string' && m ? m : null;
}
