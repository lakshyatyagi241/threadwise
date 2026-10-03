/**
 * The channel provider contract.
 *
 * Meta Cloud API is the launch provider, but India BSPs (Gupshup, Karix) have
 * different template payloads and different delivery-receipt shapes. Everything
 * above this interface is written against the port, so adding a BSP is one new
 * adapter and a `provider` value on the channel row — not a rewrite of the
 * send pipeline.
 */
import type { WabaRegistryAuth } from '../whatsapp-cloud-api-waba/waba-http';

export interface SendTemplateParams {
  /** E.164 destination. */
  to: string;
  templateName: string;
  language: string;
  /** Template category; marketing on a Marketing-Messages-Lite number is posted to `/marketing_messages`. */
  category?: string;
  /** Positional body/header/button parameters, already resolved from contact fields. */
  variables: Record<string, string>;
  /** Correlates the provider's async delivery receipts back to our message row. */
  clientReference: string;
  /** What the pre-send guard needs to know; see `OutboundSendGuard`. */
  screen?: { bulk?: boolean; source?: string };
  /**
   * The Cloud API components, already built for this recipient (header media, buttons, carousel, ...). When set they are
   * sent as they are and `variables` is ignored. See `buildSend` in meta-send-payload.ts.
   */
  components?: unknown[];
}

export interface SendTextParams {
  to: string;
  body: string;
  clientReference: string;
  /** Only legal inside the 24h customer service window. */
  replyToProviderMessageId?: string;
  /** What the pre-send guard needs to know; see `OutboundSendGuard`. */
  screen?: { bulk?: boolean; source?: string };
}

export interface SendResult {
  /** Provider's id (WhatsApp wamid). Stored on messages.provider_message_id. */
  providerMessageId: string;
  acceptedAt: Date;
}

/** Normalised delivery receipt — every provider's webhook maps into this. */
export interface NormalisedDeliveryEvent {
  providerMessageId: string;
  event: 'sent' | 'delivered' | 'read' | 'failed' | 'clicked';
  occurredAt: Date;
  errorCode?: string;
  raw: unknown;
}

/** Normalised inbound message. */
export interface NormalisedInboundMessage {
  providerMessageId: string;
  from: string;
  kind: 'text_message' | 'media' | 'interactive' | 'location' | 'voice_call';
  content: Record<string, unknown>;
  occurredAt: Date;
  raw: unknown;
}

/**
 * Any other session message (media, location, contacts, interactive, reaction) as a Cloud API object. `body` is the object
 * that sits under the `type` key, exactly as Meta documents it; the provider adds the envelope.
 */
export interface SendMessageParams {
  to: string;
  type:
    | 'image'
    | 'video'
    | 'audio'
    | 'document'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'interactive'
    | 'reaction';
  body: Record<string, unknown>;
  clientReference: string;
  /** Quote an earlier message (`context.message_id`). */
  replyToProviderMessageId?: string;
  screen?: { bulk?: boolean; source?: string };
}

export interface WhatsAppProvider {
  readonly name: string;

  sendTemplate(channelConfig: ChannelCredentials, params: SendTemplateParams): Promise<SendResult>;
  sendText(channelConfig: ChannelCredentials, params: SendTextParams): Promise<SendResult>;
  sendMessage(channelConfig: ChannelCredentials, params: SendMessageParams): Promise<SendResult>;
  /** Marks an inbound message read; `typing` also shows the typing indicator. */
  markRead(
    channelConfig: ChannelCredentials,
    providerMessageId: string,
    typing?: boolean,
  ): Promise<void>;

  /**
   * Verifies the webhook signature. Returns false on any doubt.
   *
   * This is the only thing standing between a public URL and someone writing
   * arbitrary messages into a customer's inbox — it is never optional and
   * never "skipped in dev".
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean;

  parseWebhook(payload: unknown): {
    deliveryEvents: NormalisedDeliveryEvent[];
    inboundMessages: NormalisedInboundMessage[];
  };
}

export interface ChannelCredentials {
  /** Meta: phone number id. Gupshup: app name. */
  senderId: string;
  /** Meta business token. Empty for an Interakt number that only has the partner key. */
  accessToken: string;
  businessAccountId?: string;
  /** Which route reaches the number. Absent means direct Meta (the original behaviour). */
  route?: 'meta' | 'interakt';
  /** Interakt tech-partner key (`x-access-token`). */
  authKey?: string;
  /** Marketing Messages Lite: marketing templates go to `/marketing_messages`. */
  marketingLite?: boolean;
  /** A number on a provider of the platform's provider registry: the route resolved for it. Wins over `route`. */
  registry?: WabaRegistryAuth;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
