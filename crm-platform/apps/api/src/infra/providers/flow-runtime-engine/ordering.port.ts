/**
 * The two outbound edges of natural-language ordering (TW-FLR-042) whose owners are not built in this repo yet. Each has a binding
 * that says so plainly (`unavailable`), and the ordering service works without them: a text order needs neither.
 */

/** What the customer's latest voice note or photo gives an order (Reference's `OrderMediaResolver`: Whisper transcript, vision image). */
export interface OrderMedia {
  kind: 'voice' | 'image' | null;
  /** A voice note's transcript: the order text. */
  voiceText: string | null;
  /** A photo, base64, for a vision model. */
  image: { mime: string; b64: string } | null;
  /** The stored original, kept on the order so the merchant can replay it. */
  path: string | null;
}

export interface OrderMediaPort {
  /** The customer's media from this turn, or `kind: null`. Never throws. */
  resolve(orgId: number, customerPhone: string, waitForRace: boolean): Promise<OrderMedia>;
}
export const ORDER_MEDIA_PORT = Symbol('FLR_ORDER_MEDIA_PORT');

/** No transcription or vision provider is bound: every order is read from its text. */
export class NoOrderMedia implements OrderMediaPort {
  resolve(): Promise<OrderMedia> {
    return Promise.resolve({ kind: null, voiceText: null, image: null, path: null });
  }
}

/** Posts a confirmed order into the customer's WhatsApp group with an @mention (Reference `GroupDirectory` plus `GroupNotifier`). */
export interface OrderGroupNotifyPort {
  /**
   * `posted: false` with a reason (`unavailable`, `not_member`, `none`) when nothing was posted. Best effort: never throws, never
   * delays the customer's confirmation.
   */
  notify(req: {
    orgId: number;
    customerPhone: string;
    summary: string;
    groupCode: string | null;
    customerLang: string | null;
  }): Promise<{ posted: boolean; reason: string }>;
}
export const ORDER_GROUP_NOTIFY_PORT = Symbol('FLR_ORDER_GROUP_NOTIFY_PORT');

/** No group directory is bound: the post is skipped and noted, as Reference does for a customer in no group. */
export class NoOrderGroupNotify implements OrderGroupNotifyPort {
  notify(): Promise<{ posted: boolean; reason: string }> {
    return Promise.resolve({ posted: false, reason: 'unavailable' });
  }
}
