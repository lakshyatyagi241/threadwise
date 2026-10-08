import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type {
  BaileysCard,
  BaileysCatalogBridge,
  SentMessage,
} from '../../../infra/providers/catalog-products/catalog-provider.port';
import type { SendCommand } from './outbound';
import { OutboundRegistry } from './outbound-registry.service';

const digits = (s: string): string => s.replace(/\D+/g, '');

/** One card as the picture's caption: the name, the price, what it is, and where to buy it. */
export function cardCaption(c: BaileysCard): string {
  const lines = [`*${c.name}*`, `${c.currency} ${c.price.toFixed(2)}`];
  if (c.availability && c.availability !== 'in stock') lines.push(c.availability);
  if (c.description) lines.push(c.description.slice(0, 200));
  if (c.url) lines.push(c.url);
  return lines.join('\n');
}

/**
 * The catalog's way to send through the unofficial engine (WD-NODE-024, WD-CAT-014): the same three sends WaDesk posted to its Node bridge
 * over HTTP, here through the in-process outbound port, so the pacing, the pre-send screen and the device ownership of the engine apply.
 *
 * Differences from WaDesk, recorded in the NODE parity file: the official library cannot send a product carousel, so each card goes as
 * its own picture with the card as caption (a product without a picture goes as text), after the header and body as one text.
 */
@Injectable()
export class NodeCatalogBridge implements BaileysCatalogBridge {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: OutboundRegistry,
  ) {}

  async sendText(input: { senderPhone: string; to: string; text: string }): Promise<SentMessage> {
    return this.send(input.senderPhone, { type: 'text', to: digits(input.to), body: input.text });
  }

  async sendImage(input: {
    senderPhone: string;
    to: string;
    imageUrl: string;
    caption: string;
  }): Promise<SentMessage> {
    return this.send(input.senderPhone, {
      type: 'media',
      to: digits(input.to),
      mediaUrl: input.imageUrl,
      caption: input.caption,
      mimeType: 'image/jpeg',
    });
  }

  async sendCarousel(input: {
    senderPhone: string;
    to: string;
    cards: readonly BaileysCard[];
    headerText: string;
    bodyText: string;
    footerText: string;
  }): Promise<SentMessage> {
    const intro = [input.headerText, input.bodyText, input.footerText]
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n');
    let last: SentMessage = { messageId: null, raw: null };
    if (intro)
      last = await this.sendText({ senderPhone: input.senderPhone, to: input.to, text: intro });
    for (const card of input.cards) {
      last = card.image_url
        ? await this.sendImage({
            senderPhone: input.senderPhone,
            to: input.to,
            imageUrl: card.image_url,
            caption: cardCaption(card),
          })
        : await this.sendText({
            senderPhone: input.senderPhone,
            to: input.to,
            text: cardCaption(card),
          });
    }
    return last;
  }

  /** The connected device with this number, in the caller's workspace when there is one (the catalog is called from a request or a worker). */
  private async send(senderPhone: string, command: SendCommand): Promise<SentMessage> {
    const phone = digits(senderPhone);
    const orgId = RequestContextStore.peek()?.orgId ?? null;
    const device = await this.db.privileged(async (tx) => {
      const res = (await tx.execute(
        sql`SELECT org_id, id, coalesce(nullif(device_name, ''), phone_number) AS label FROM devices
             WHERE status = 'connected' AND active
               AND regexp_replace(coalesce(country_code, '') || coalesce(phone_number, ''), '[^0-9]', '', 'g') = ${phone}
               AND (${orgId}::bigint IS NULL OR org_id = ${orgId})
             ORDER BY id DESC LIMIT 1`,
      )) as unknown as {
        rows: Array<{ org_id: number | string; id: number | string; label: string | null }>;
      };
      return res.rows[0];
    });
    const transport = this.registry.get('baileys');
    if (!device || !transport) {
      throw new Error(
        'This WhatsApp number is not connected. Open Devices and scan the QR code again.',
      );
    }
    const open = await transport.open(Number(device.org_id), {
      engine: 'baileys',
      id: Number(device.id),
      phoneDigits: phone,
      label: device.label ?? '',
    });
    const outcome = await open.send(command, {
      clientReference: randomUUID(),
      screen: { source: 'catalog' },
    });
    return { messageId: outcome.providerMessageId, raw: outcome };
  }
}
