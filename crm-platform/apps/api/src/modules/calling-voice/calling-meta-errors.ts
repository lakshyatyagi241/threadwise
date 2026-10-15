import type { CallingMetaReason } from '@crm/contracts';

/** What the calling domain needs to know about a failed Meta request (a `WabaApiError`, without importing it into pure code). */
export interface MetaFailure {
  /** HTTP status; 0 when Meta never answered. */
  status: number;
  code: number | null;
  subcode: number | null;
  message: string;
}

/** Meta's code for "the token lacks whatsapp_business_management" (sub-code), the same one `WabaApiError.missingBusinessManagement` reads. */
const SUBCODE_MISSING_MANAGEMENT = 1349174;

/**
 * Meta's calling error codes that have a stable meaning. Anything not listed here falls to the wording rules below and then to `unknown`;
 * add a code here only once it has been seen in a real answer.
 */
const BY_CODE: Readonly<Record<number, CallingMetaReason>> = {
  /** Not a Cloud API number: the line is shared with the WhatsApp Business app (coexistence). */
  141000: 'coexistence',
  /** Calling is not enabled on the business number. */
  138000: 'calling_not_enabled',
  /** The customer's WhatsApp cannot receive calls (an old app, or calls turned off there). */
  138001: 'receiver_uncallable',
  /** The customer has not given (or has withdrawn) permission to be called. */
  138006: 'no_call_permission',
  /** Too many permission requests to the same customer in the window. */
  138009: 'permission_request_limit',
};

/**
 * The reason behind a refusal from Meta, as a stable code the web turns into words (EXT-CALL-009). By Meta's error code first; the few
 * refusals that arrive with only a sentence (the prerequisite and missing-permission ones) are recognised by their wording HERE, on the server
 * and only together with code 100, so the browser never reads a message.
 */
export function metaReason(f: MetaFailure): CallingMetaReason {
  if (f.status === 0 || f.status >= 500) return 'meta_unreachable';
  if (f.code !== null && BY_CODE[f.code]) return BY_CODE[f.code]!;
  if (f.code === 190) return 'token_expired';
  if (f.subcode === SUBCODE_MISSING_MANAGEMENT) return 'permission_scope';
  if (f.code === 10 || (f.code !== null && f.code >= 200 && f.code <= 299)) {
    return 'permission_scope';
  }
  // Meta's one prerequisite refusal and its "missing permissions" refusal arrive as a generic parameter error (100) with only a sentence:
  // the wording counts ONLY together with that code, so an unrelated message that happens to contain these words is not mis-read.
  if (f.code === 100) {
    if (/pre-?requisite/i.test(f.message)) return 'prerequisites';
    if (/missing permissions|does not have permission/i.test(f.message)) return 'permission_scope';
  }
  return 'unknown';
}

/** `details` entry of a problem that carries the reason (read by the web as `fieldErrors` path `reason`). */
export const reasonDetail = (
  reason: CallingMetaReason,
): Array<{ path: string; message: string }> => [{ path: 'reason', message: reason }];
