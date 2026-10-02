import { describe, expect, it, vi } from 'vitest';
import { WabaTransport } from '../../../src/modules/node-bridge-runtime/outbound/waba.transport';

function build(meta: Record<string, unknown> = {}, creds: Record<string, unknown> = {}) {
  const provider = {
    sendText: vi.fn(async () => ({ providerMessageId: 'wamid.t' })),
    sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.m' })),
  };
  const db = {
    tx: async (f: (t: unknown) => unknown) =>
      f({ execute: async () => ({ rows: [{ credentials_json: 'enc', meta_json: meta }] }) }),
  };
  const crypto = {
    decrypt: () => JSON.stringify({ access_token: 'tok', phone_number_id: '99', ...creds }),
  };
  return { provider, t: new WabaTransport(db as never, crypto as never, provider as never) };
}
const ctx = { clientReference: 'c' } as never;

describe('Cloud API transport', () => {
  it('sends media by link through the provider, caption kept, filename on documents', async () => {
    const { t, provider } = build();
    const open = await t.open(1, { id: 1 } as never);
    await open.send(
      {
        type: 'media',
        to: '+1',
        mediaUrl: 'https://x.test/a.pdf',
        caption: 'hi',
        fileName: 'a.pdf',
      },
      ctx,
    );
    expect(provider.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: '99', route: 'meta' }),
      expect.objectContaining({
        type: 'document',
        body: { link: 'https://x.test/a.pdf', caption: 'hi', filename: 'a.pdf' },
      }),
    );
  });
  it('drops the caption on audio and routes Interakt numbers with their key', async () => {
    const { t, provider } = build(
      { provider: 'interakt', waba_id: 'W1' },
      { auth_key: 'k', access_token: '' },
    );
    const open = await t.open(1, { id: 1 } as never);
    await open.send(
      { type: 'media', to: '+1', mediaUrl: 'https://x.test/a.ogg', caption: 'no', voiceNote: true },
      ctx,
    );
    const [creds, params] = provider.sendMessage.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(creds).toMatchObject({ route: 'interakt', authKey: 'k', businessAccountId: 'W1' });
    expect(params.body).toEqual({ link: 'https://x.test/a.ogg' });
  });
  it('refuses a non-https link before calling Meta', async () => {
    const { t, provider } = build();
    const open = await t.open(1, { id: 1 } as never);
    await expect(
      open.send({ type: 'media', to: '+1', mediaUrl: 'http://x.test/a.jpg' }, ctx),
    ).rejects.toThrow('public https link');
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });
});
