import { describe, expect, it, vi } from 'vitest';
import {
  EngineCommerceSender,
  templateText,
} from '../../../src/modules/shopify-woocommerce/_shims/engine-commerce-sender';
import type { EcomTemplate } from '../../../src/modules/shopify-woocommerce/_shims/tokens';
import type { EventContext } from '../../../src/modules/shopify-woocommerce/event-rules';

const template: EcomTemplate = {
  id: 1,
  uuid: 'u',
  name: 'order_update',
  language: 'en_US',
  body: 'Hi {{1}}, order {{2}} is {{status}}.',
  header: 'Acme',
  footer: 'Reply STOP to opt out',
};
const ctx: EventContext = { vars: { name: 'Ada', status: 'paid' }, positional: ['Ada', '#1001'] };
const UUID = '11111111-1111-4111-8111-111111111111';

/** Fakes for everything the sender talks to; `rows` answers the two raw lookups in order. */
function build(opts: { sender?: { engine: string; id: number } | null; rows?: unknown[][] } = {}) {
  const rows = [...(opts.rows ?? [])];
  const tx = { execute: vi.fn(() => Promise.resolve({ rows: rows.shift() ?? [] })) };
  const db = { txAs: (_: unknown, fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx)) };
  const sender = opts.sender === undefined ? { engine: 'baileys', id: 5 } : opts.sender;
  const resolver = {
    resolve: vi.fn(() => Promise.resolve(sender && { ...sender, phoneDigits: '1', label: 'L' })),
  };
  const sent: unknown[] = [];
  const transport = {
    open: vi.fn(() =>
      Promise.resolve({
        send: (cmd: unknown, c: unknown) => {
          sent.push({ cmd, c });
          return Promise.resolve({ providerMessageId: 'tx1' });
        },
      }),
    ),
  };
  const outbound = { get: vi.fn(() => transport) };
  const wabaSent: unknown[] = [];
  const engines = {
    get: vi.fn(() => ({
      open: () =>
        Promise.resolve({
          send: (m: unknown) => {
            wabaSent.push(m);
            return Promise.resolve({ providerMessageId: 'w1' });
          },
        }),
    })),
  };
  const s = new EngineCommerceSender(
    db as never,
    resolver as never,
    outbound as never,
    engines as never,
  );
  return { s, tx, resolver, outbound, engines, sent, wabaSent };
}

describe('the commerce sender (WD-ECOM-010)', () => {
  it('renders header, body and footer with their values for a text engine', () => {
    expect(templateText(template, ctx)).toBe(
      'Acme\n\nHi Ada, order #1001 is paid.\n\nReply STOP to opt out',
    );
    expect(templateText({ ...template, header: null, footer: ' ' }, ctx)).toBe(
      'Hi Ada, order #1001 is paid.',
    );
  });

  it("sends a text engine's template as rendered text through the outbound layer, never the Cloud API", async () => {
    const f = build({ rows: [[{ default_engine: 'baileys' }]] });
    const out = await f.s.send(7, { to: '15550001', template, ctx, reference: 'r1' });
    expect(out).toEqual({ providerMessageId: 'tx1' });
    expect(f.resolver.resolve).toHaveBeenCalledWith(f.tx, 7, {
      provider: 'baileys',
      deviceId: null,
    });
    expect(f.sent).toEqual([
      {
        cmd: {
          type: 'text',
          to: '15550001',
          body: 'Acme\n\nHi Ada, order #1001 is paid.\n\nReply STOP to opt out',
        },
        c: { clientReference: 'r1', screen: { bulk: true, source: 'commerce' } },
      },
    ]);
    expect(f.engines.get).not.toHaveBeenCalled();
  });

  it('sends the approved template with the numbered values through a Cloud API number', async () => {
    const f = build({ sender: { engine: 'waba', id: 9 }, rows: [[{ default_engine: 'waba' }]] });
    await f.s.send(7, { to: '15550001', template, ctx, reference: 'r2' });
    expect(f.wabaSent).toEqual([
      {
        to: '15550001',
        templateName: 'order_update',
        language: 'en_US',
        clientReference: 'r2',
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ada' },
              { type: 'text', text: '#1001' },
            ],
          },
        ],
      },
    ]);
    expect(f.outbound.get).not.toHaveBeenCalled();
  });

  it('uses the chosen number when it is connected, and says so when it is not', async () => {
    const ok = build({ sender: { engine: 'twilio', id: 3 }, rows: [[{ id: 3 }]] });
    await ok.s.send(7, { to: '1', template, ctx, reference: 'r', senderKey: `twilio:${UUID}` });
    expect(ok.resolver.resolve).toHaveBeenCalledWith(ok.tx, 7, { provider: 'twilio', deviceId: 3 });

    const gone = build({ sender: null, rows: [[{ id: 3 }]] });
    await expect(
      gone.s.send(7, { to: '1', template, ctx, reference: 'r', senderKey: `twilio:${UUID}` }),
    ).rejects.toThrow('The chosen WhatsApp number is not connected.');
    const unknown = build({ rows: [[]] });
    await expect(
      unknown.s.send(7, { to: '1', template, ctx, reference: 'r', senderKey: `twilio:${UUID}` }),
    ).rejects.toThrow('The chosen WhatsApp number is not connected.');
    const bad = build();
    for (const key of ['nope', 'sms:' + UUID, 'waba:not-a-uuid', 'twilio:']) {
      await expect(
        bad.s.send(7, { to: '1', template, ctx, reference: 'r', senderKey: key }),
      ).rejects.toThrow('chosen');
    }
    expect(bad.tx.execute).not.toHaveBeenCalled();
  });

  it('has no number to send from: canSend is false and a send says why', async () => {
    const f = build({ sender: null, rows: [[], []] });
    expect(await f.s.canSend(7)).toBe(false);
    await expect(f.s.send(7, { to: '1', template, ctx, reference: 'r' })).rejects.toThrow(
      'No WhatsApp number is connected to send from.',
    );
    expect(await build({ rows: [[]] }).s.canSend(7)).toBe(true);
  });

  it('answers a customer as plain text, not as a bulk send', async () => {
    const f = build({ rows: [[{ default_engine: 'baileys' }]] });
    await f.s.sendText(7, { to: '15550001', body: 'Thanks!', reference: 'a1' });
    expect(f.sent).toEqual([
      {
        cmd: { type: 'text', to: '15550001', body: 'Thanks!' },
        c: { clientReference: 'a1', screen: { bulk: false, source: 'commerce' } },
      },
    ]);
  });
});
