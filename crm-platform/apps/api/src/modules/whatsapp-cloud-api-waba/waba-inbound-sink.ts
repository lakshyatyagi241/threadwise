import { Injectable, Logger } from '@nestjs/common';
import type {
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
} from '../../infra/providers/whatsapp/whatsapp.port';

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
export interface WabaInboundSink {
  onMessage(ctx: InboundContext, message: NormalisedInboundMessage): Promise<void>;
  onStatus(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void>;
}

export const WABA_INBOUND_SINK = Symbol('WABA_INBOUND_SINK');

@Injectable()
export class LoggingInboundSink implements WabaInboundSink {
  private readonly logger = new Logger('WabaInbound');

  async onMessage(ctx: InboundContext, message: NormalisedInboundMessage): Promise<void> {
    this.logger.warn(
      {
        orgId: ctx.orgId,
        number: ctx.configUuid,
        kind: message.kind,
        providerMessageId: message.providerMessageId,
      },
      'inbound message received but no inbox is bound to WABA_INBOUND_SINK yet; it was acknowledged and not stored',
    );
  }

  async onStatus(ctx: InboundContext, event: NormalisedDeliveryEvent): Promise<void> {
    this.logger.debug(
      { orgId: ctx.orgId, event: event.event, providerMessageId: event.providerMessageId },
      'delivery report outside any broadcast',
    );
  }
}
