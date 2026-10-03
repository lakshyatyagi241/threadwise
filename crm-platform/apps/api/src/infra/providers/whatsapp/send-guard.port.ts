/**
 * The pre-send check every outbound WhatsApp message passes (WD-AUTH-040/041).
 *
 * Providers call it first thing in `sendText` / `sendTemplate`, so a pipeline
 * (inbox, broadcast, scheduled, flow, auto-reply, queue worker) cannot reach a
 * provider without it. The emergency halt is checked at send time, not at
 * enqueue time, which is what WaDesk's halt missed for queued bulk sends.
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

  /**
   * The text to put on the wire: `body` with the workspace's outgoing footer
   * appended (WD-AUTH-029). Resolved per workspace from its plan, so a plan that
   * removes branding sends its own footer or none and every other plan sends the
   * platform's. Called for plain text only, after `beforeSend`, so the footer is
   * never part of what the content filters read.
   *
   * Never call it for a template message: approved template content cannot be changed.
   */
  withFooter(input: { orgId?: number | null; body: string }): Promise<string>;
}

export const OUTBOUND_SEND_GUARD = Symbol('OUTBOUND_SEND_GUARD');
