import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../../../chat-conversations';
import { CatalogConciergeService } from '../../../../catalog-products';

/**
 * The catalog concierge on the inbound message (TW-CAT-028, TW-FLR-041): after the flows had their turn, a free-text product question
 * ("got any red shoes under 2000?") on a WhatsApp Cloud API number is answered with a product list of the best matches, when the
 * merchant switched it on. It never answers a message a flow already took, and answering counts as taking it, so an auto reply or an AI
 * agent behind it stays quiet. Worker only, like every inbound listener.
 */
@Injectable()
export class CatalogConciergeListener implements InboundMessageListener, OnModuleInit {
  readonly name = 'catalog-concierge';
  readonly bot = true as const;
  readonly after = true as const;

  constructor(
    private readonly hooks: InboundMessageHooks,
    private readonly concierge: CatalogConciergeService,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async onStored(
    e: InboundStoredEvent,
    prior: { consumed: boolean },
  ): Promise<{ consumed: boolean }> {
    const body = e.message.body?.trim() ?? '';
    if (
      prior.consumed ||
      e.message.kind !== 'text' ||
      e.channelKind !== 'whatsapp_cloud' ||
      !body
    ) {
      return { consumed: false };
    }
    return { consumed: await this.concierge.handleInbound(e.orgId, e.peerKey, body) };
  }
}
