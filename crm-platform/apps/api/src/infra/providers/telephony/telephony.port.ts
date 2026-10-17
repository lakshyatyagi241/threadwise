/**
 * The telephony provider contract: a telephony or IVR vendor (Twilio, Exotel, Knowlarity, MyOperator, Ozonetel...) as the call logging
 * framework needs it. Everything above is written against this port, so a vendor is one adapter and a `provider` value on a connection.
 *
 * Two jobs, both optional per vendor:
 *  - REPORT: the vendor posts a status callback when a call finishes. `verifyWebhook` proves it is the vendor's (never skipped), and
 *    `parseWebhook` turns the vendor's payload into `NormalisedCallEvent`s. No vendor shape goes past this file.
 *  - BRIDGE: `clickToCall` asks the vendor to ring the agent first and then the customer ("click-to-call"). The finished call arrives as
 *    a report like any other.
 *
 * Adapters never throw for an expected failure (a vendor being down, a refused number): they answer `{ ok: false }`.
 * No adapter in this repository calls a real vendor; see docs/specs/call-logging.md for how a real one plugs in.
 */
import type { TelephonyCallStatus } from '@crm/contracts';

export interface NormalisedCallEvent {
  /** The vendor's id of this report (a retry carries the same one). */
  eventId: string;
  /** The vendor's id of the call. The entry is unique on it. */
  callId: string;
  direction: 'inbound' | 'outbound';
  status: TelephonyCallStatus;
  /** The customer's number as the vendor wrote it; null for a caller who withheld it. */
  customerNumber: string | null;
  /** Our number the call came in on or went out from. */
  ourNumber: string | null;
  startedAt: Date;
  durationSec: number;
  /** The vendor's reference to the recording (never audio). */
  recordingRef: string | null;
}

export interface ClickToCallRequest {
  /** Rung first. */
  agentNumber: string;
  /** Rung when the agent picks up. */
  customerNumber: string;
  /** The line to show the customer; null for the vendor's default. */
  ourNumber: string | null;
  /** Our id for the attempt: echoed by vendors that support custom fields. */
  correlationId: string;
}

export type ClickToCallResult =
  { ok: true; callId: string } | { ok: false; error: string; code?: string };

export interface TelephonyProvider {
  /** The value stored in `telephony_connections.provider`. */
  readonly key: string;
  readonly label: string;
  readonly supportsClickToCall: boolean;
  /** True only for a callback proven to come from the vendor, for this connection's secret. Constant time; false on any doubt. */
  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
    now?: Date,
  ): boolean;
  /** The finished calls the callback reports; empty for a payload that reports none (or cannot be read). Never throws. */
  parseWebhook(rawBody: Buffer): NormalisedCallEvent[];
  clickToCall(req: ClickToCallRequest): Promise<ClickToCallResult>;
}
