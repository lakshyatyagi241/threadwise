/**
 * The pre-send check every outbound WhatsApp message passes (TW-AUTH-040/041).
 *
 * Providers call it first thing in `sendText` / `sendTemplate`, so a pipeline
 * (inbox, broadcast, scheduled, flow, auto-reply, queue worker) cannot reach a
 * provider without it. The emergency halt is checked at send time, not at
 * enqueue time, which is what Reference's halt missed for queued bulk sends.
 *
 * The implementation lives in the auth domain (`SendGuardModule`); the provider
 * only knows this interface.
 */
export interface OutboundSendInput {
  /** Tenant the message belongs to; the ambient request context when omitted. */
  orgId?: number | null;
  /** Text the content filters should look at (message body, or template variables). */
  body?: string;
  /** Campaign / broadcast / scheduled batch: halt and content only, no per-message rate caps. */
  bulk?: boolean;
  /** Recorded with a flagged or blocked decision: 'inbox' | 'broadcast' | ... */
  source?: string;
}

export interface OutboundSendGuard {
  /** Resolves when the send may proceed; throws an `AppError` (AUTH_SEND_HALTED / AUTH_SEND_BLOCKED) otherwise. */
  beforeSend(input: OutboundSendInput): Promise<void>;
}

export const OUTBOUND_SEND_GUARD = Symbol('OUTBOUND_SEND_GUARD');
