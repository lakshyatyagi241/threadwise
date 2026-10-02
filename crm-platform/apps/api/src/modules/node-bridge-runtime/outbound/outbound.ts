/**
 * The outbound send port (WD-NODE-022). One command shape and one registry for every engine, so a scheduled message, a
 * broadcast or a chat reply picks its transport by the sender's engine and never knows how that engine connects.
 *
 * WaDesk's bridge took the engine from the request's `provider` field and branched in each endpoint. Here the engine is a
 * property of the sender row, and each transport registers itself under its engine name.
 */

/** What to send. The transport turns it into its own protocol; one that cannot send a kind says so (UnsupportedSendError). */
export type SendCommand =
  | { type: 'text'; to: string; body: string }
  | { type: 'media'; to: string; mediaUrl: string; caption?: string; fileName?: string }
  | {
      type: 'location';
      to: string;
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };

export interface SendContext {
  /** Correlates the provider's later receipts back to our row. */
  clientReference: string;
  /** What the pre-send guard needs to know (bulk sends are screened harder than a single reply). */
  screen?: { bulk?: boolean; source?: string };
}

export interface SendOutcome {
  /** The provider's message id; null when the transport cannot tell (the unofficial engine sometimes cannot). */
  providerMessageId: string | null;
}

/** A number resolved to send through, one row of `devices` or `wa_provider_configs`. */
export interface SenderRef {
  engine: string;
  /** Internal id in the engine's own table. */
  id: number;
  /** The sender's own number as digits; empty means it cannot be used. */
  phoneDigits: string;
  label: string;
}

export interface OpenTransport {
  send(command: SendCommand, context: SendContext): Promise<SendOutcome>;
}

/** One per engine. `open` loads the credentials once and throws when the number cannot send. */
export interface EngineTransport {
  open(orgId: number, sender: SenderRef): Promise<OpenTransport>;
}

/** The transport cannot send this kind of message. The text is shown to the user, so it says what to do instead. */
export class UnsupportedSendError extends Error {}
