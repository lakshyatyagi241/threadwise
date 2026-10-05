import { Injectable, Logger } from '@nestjs/common';
import type {
  NormalisedDeliveryEvent,
  NormalisedInboundMessage,
} from '../../infra/providers/whatsapp/whatsapp.port';
import {
  WABA_INBOUND_SINK,
  WABA_INBOUND_SINK_OVERRIDE,
  type BusinessAppEcho,
  type InboundContext,
  type WabaInboundSink,
} from './waba-inbound.port';

export {
  WABA_INBOUND_SINK,
  WABA_INBOUND_SINK_OVERRIDE,
  type BusinessAppEcho,
  type InboundContext,
  type WabaInboundSink,
};

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
