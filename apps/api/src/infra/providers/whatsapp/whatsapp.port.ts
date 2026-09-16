/**
 * The channel provider contract.
 *
 * Meta Cloud API is the launch provider, but India BSPs (Gupshup, Karix) have
 * different template payloads and different delivery-receipt shapes. Everything
 * above this interface is written against the port, so adding a BSP is one new
 * adapter and a `provider` value on the channel row — not a rewrite of the
 * send pipeline.
 */

export interface SendTemplateParams {
  /** E.164 destination. */
  to: string;
  templateName: string;
  language: string;
  /** Positional body/header/button parameters, already resolved from contact fields. */
  variables: Record<string, string>;
  /** Correlates the provider's async delivery receipts back to our message row. */
  clientReference: string;
}

export interface SendTextParams {
  to: string;
  body: string;
  clientReference: string;
  /** Only legal inside the 24h customer service window. */
  replyToProviderMessageId?: string;
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

export interface WhatsAppProvider {
  readonly name: string;

  sendTemplate(channelConfig: ChannelCredentials, params: SendTemplateParams): Promise<SendResult>;
  sendText(channelConfig: ChannelCredentials, params: SendTextParams): Promise<SendResult>;

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
  accessToken: string;
  businessAccountId?: string;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
