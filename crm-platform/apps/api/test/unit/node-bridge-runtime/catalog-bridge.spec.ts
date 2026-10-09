import { describe, expect, it, vi } from 'vitest';
import {
  NodeCatalogBridge,
  cardCaption,
} from '../../../src/modules/node-bridge-runtime/outbound/catalog-bridge.adapter';

const card = (o: Partial<Parameters<typeof cardCaption>[0]> = {}) => ({
  retailer_id: 'r1',
  id: 'p1',
  name: 'Honey',
  description: null,
  image_url: 'https://cdn.example.org/honey.jpg',
  price: 10.5,
  currency: 'INR',
  category: null,
  availability: 'in stock',
  url: 'https://shop.example.org/honey',
  ...o,
});

function build(device: Record<string, unknown> | null = { org_id: 3, id: 9, label: 'Line' }) {
  const sent: unknown[] = [];
  const open = {
    send: vi.fn(
      async (command: unknown) => (sent.push(command), { providerMessageId: `m${sent.length}` }),
    ),
  };
  const transport = { open: vi.fn().mockResolvedValue(open) };
  const registry = { get: vi.fn().mockReturnValue(transport) };
  const db = {
    privileged: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: device ? [device] : [] }) }),
    ),
  };
  const bridge = new NodeCatalogBridge(db as never, registry as never);
  return { bridge, sent, transport };
}

describe('the catalog through the unofficial engine (TW-NODE-024)', () => {
  it('writes a card as name, price, availability when not in stock, and link', () => {
    expect(cardCaption(card())).toBe('*Honey*\nINR 10.50\nhttps://shop.example.org/honey');
    expect(cardCaption(card({ availability: 'out of stock', url: null }))).toBe(
      '*Honey*\nINR 10.50\nout of stock',
    );
  });

  it('sends text and a picture with its caption through the device with that number', async () => {
    const { bridge, sent, transport } = build();
    await bridge.sendText({ senderPhone: '+91 98000 00001', to: '+91 98111 11111', text: 'hi' });
    await bridge.sendImage({
      senderPhone: '919800000001',
      to: '919811111111',
      imageUrl: 'https://x/y.jpg',
      caption: 'c',
    });
    expect(sent).toEqual([
      { type: 'text', to: '919811111111', body: 'hi' },
      {
        type: 'media',
        to: '919811111111',
        mediaUrl: 'https://x/y.jpg',
        caption: 'c',
        mimeType: 'image/jpeg',
      },
    ]);
    expect(transport.open).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ engine: 'baileys', id: 9, phoneDigits: '919800000001' }),
    );
  });

  it('sends a carousel as one intro text, then each card as a picture (a card without one as text)', async () => {
    const { bridge, sent } = build();
    const r = await bridge.sendCarousel({
      senderPhone: '919800000001',
      to: '919811111111',
      cards: [card(), card({ name: 'Tea', image_url: null, url: null })],
      headerText: 'Shop',
      bodyText: 'Pick one',
      footerText: '',
    });
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ type: 'text', body: 'Shop\nPick one' });
    expect(sent[1]).toMatchObject({ type: 'media', caption: expect.stringContaining('Honey') });
    expect(sent[2]).toMatchObject({ type: 'text', body: expect.stringContaining('Tea') });
    expect(r.messageId).toBe('m3');
  });

  it('says so in words when no connected device has that number', async () => {
    const { bridge } = build(null);
    await expect(bridge.sendText({ senderPhone: '1', to: '2', text: 'x' })).rejects.toThrow(
      /not connected/,
    );
  });
});
