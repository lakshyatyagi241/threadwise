/**
 * The outbound send port (TW-NODE-022). One command shape and one registry for every engine, so a scheduled message, a
 * broadcast or a chat reply picks its transport by the sender's engine and never knows how that engine connects.
 *
 * Reference's bridge took the engine from the request's `provider` field and branched in each endpoint. Here the engine is a
 * property of the sender row, and each transport registers itself under its engine name.
 */

export {
  UnsupportedSendError,
  type MessageAction,
  type SendCommand,
  type SendContext,
  type SendOutcome,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import type {
  SendCommand,
  SendContext,
  SendOutcome,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';

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
