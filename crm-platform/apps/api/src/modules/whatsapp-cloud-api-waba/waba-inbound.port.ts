import type {
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
} from '../../infra/providers/whatsapp/whatsapp.port';

/**
 * The inbound seam of the WABA domain, as a leaf file: tokens and types only. The inbox binds its own sink through these without
 * importing the WABA module's files (a file cycle there leaves a class `undefined` while Nest reads its constructor).
 */

export interface HistoryItem {
  providerMessageId: string;
  /** The customer's number as digits. */
  customer: string;
  /** Written by the business (from one of the workspace's own numbers), not by the customer. */
  outgoing: boolean;
  text: string;
  at: Date;
}

/** Which workspace and number an inbound event belongs to, resolved from the payload's ids. */
export interface InboundContext {
  orgId: number;
  /** wa_provider_configs.id and uuid of the receiving number. */
  configId: number;
  configUuid: string;
  wabaId: string;
  phoneNumberId: string | null;
  /** The sender's WhatsApp profile name, when the payload carried one. */
  contactName: string | null;
}

/**
 * Where inbound traffic goes once it is authenticated, routed and de-duplicated. The inbox domain (TIB1) owns the answer:
 * it creates or finds the contact and thread, stores the message and raises the realtime event. Until it binds
 * `WABA_INBOUND_SINK`, the default below only logs, so nothing is silently dropped without a trace.
 *
 * `onStatus` receives delivery reports the broadcast domain did not claim (a message sent from the inbox, a flow, an auto-reply).
 */
/** A message the business typed on the WhatsApp Business app (coexistence, TW-WABA-044): outbound, from the phone, not a customer's. */
export interface BusinessAppEcho {
  providerMessageId: string;
  /** The customer's number as digits. */
  to: string;
  /** What the thread shows: the text or caption, or a placeholder naming the kind of file. */
  text: string;
  occurredAt: Date;
}

export interface WabaInboundSink {
  /** Imported coexistence history (TW-WABA-046): stored backdated and quiet, deduplicated by message id. */
  onHistory?(ctx: InboundContext, items: HistoryItem[]): Promise<void>;
  /** A message in a Cloud API group (TW-WABA-039): storage only, on the group's own thread, no contact, no automation. */
  onGroupMessage?(
    ctx: InboundContext,
    message: NormalisedInboundMessage,
    group: { groupId: string; title: string | null },
  ): Promise<void>;
  /** Mirrors a business-app message onto its thread as outbound, without unread, routing or automation. */
  onEcho?(ctx: InboundContext, echo: BusinessAppEcho): Promise<void>;
  onMessage(ctx: InboundContext, message: NormalisedInboundMessage): Promise<void>;
  onStatus(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void>;
}

export const WABA_INBOUND_SINK = Symbol('WABA_INBOUND_SINK');

/**
 * Where another domain announces its sink. `WabaModule` binds `WABA_INBOUND_SINK` to this when some (global) module provides it, and to
 * the logging default otherwise, so the inbox can take over without this module importing the inbox (the dependency points the other way).
 */
export const WABA_INBOUND_SINK_OVERRIDE = Symbol('WABA_INBOUND_SINK_OVERRIDE');
