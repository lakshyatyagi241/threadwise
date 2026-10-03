import type { WabaConnection } from '../whatsapp-cloud-api-waba/waba-admin.port';

/** The calls API's actions (TW-CALL-008, 013, 015, 016): one POST to `/{phone_number_id}/calls` with an `action`. */
export type CallAction = 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate';

export interface CallActionParams {
  /** `connect`: the customer's number, digits only. */
  to?: string;
  /** Every action but `connect`: Meta's id for the call. */
  callId?: string;
  /** `connect` carries an offer, `pre_accept` and `accept` an answer. */
  sdp?: { type: 'offer' | 'answer'; sdp: string };
  /** `connect`: echoed back in the connect webhook so the row can be matched (TW-CALL-011 rule 1). */
  opaque?: string;
  /** `reject`: why (`REJECTED`, `INVALID_SDP`, `OPERATOR_ERROR`, `NO_OPERATOR`). */
  reason?: string;
}

/**
 * What the calling domain asks of Meta (TW-CALL-004, 005, 008, 013 to 016). Written against a port so the calling logic never builds a URL
 * or a header, and a failed request arrives as a `WabaApiError` the domain translates into words.
 */
export interface CallingGraph {
  /** Switches calling on or off for the number (`POST /{phone_number_id}/settings`). Returns Meta's body. */
  setCalling(conn: WabaConnection, enabled: boolean): Promise<Record<string, unknown>>;
  /** Sends the interactive "can we call you" message (`call_permission_request`). */
  requestPermission(
    conn: WabaConnection,
    to: string,
    body: string,
  ): Promise<Record<string, unknown>>;
  callAction(
    conn: WabaConnection,
    action: CallAction,
    params: CallActionParams,
  ): Promise<Record<string, unknown>>;
}

export const CALLING_GRAPH = Symbol('CALLING_GRAPH');
