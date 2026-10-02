import { describe, expect, it, vi } from 'vitest';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';
import { WabaTransport } from '../../../src/modules/node-bridge-runtime/outbound/waba.transport';

const guard = {
  beforeSend: async () => undefined,
  withFooter: async (i: { body: string }) => `${i.body}|FOOT`,
};
const creds = { senderId: '99', accessToken: 'tok' };

describe('Cloud API media and real post', () => {
  it('posts media to Graph with link, caption+footer and document filename', async () => {
    const seen: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
        seen.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization! });
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.7' }] }), { status: 200 });
      }),
    );
    const p = new MetaCloudProvider({ get: () => 'v21.0' } as never, guard);
    const r = await p.sendMedia(creds, {
      to: '+1',
      kind: 'document',
      link: 'https://x.test/a.pdf',
      caption: 'hi',
      fileName: 'a.pdf',
      clientReference: 'c',
    });
    expect(r.providerMessageId).toBe('wamid.7');
    expect(seen[0]!.url).toBe('https://graph.facebook.com/v21.0/99/messages');
    expect(seen[0]!.auth).toBe('Bearer tok');
    expect(seen[0]!.body).toMatchObject({
      type: 'document',
      document: { link: 'https://x.test/a.pdf', caption: 'hi|FOOT', filename: 'a.pdf' },
    });
  });

  it('surfaces the Meta error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad token' } }), { status: 401 }),
      ),
    );
    const p = new MetaCloudProvider({ get: () => 'v21.0' } as never, guard);
    await expect(p.sendText(creds, { to: '+1', body: 'x', clientReference: 'c' })).rejects.toThrow(
      'bad token',
    );
  });

  it('never puts a caption or footer on audio', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ messages: [{ id: 'w' }] }), { status: 200 });
      }),
    );
    const p = new MetaCloudProvider({ get: () => 'v21.0' } as never, guard);
    await p.sendMedia(creds, {
      to: '+1',
      kind: 'audio',
      link: 'https://x.test/a.ogg',
      caption: 'no',
      clientReference: 'c',
    });
    expect(bodies[0]!.audio).toEqual({ link: 'https://x.test/a.ogg' });
  });

  it('refuses a non-https media link before calling Meta', async () => {
    const fn = vi.fn();
    const provider = { sendMedia: fn } as never;
    const t = new WabaTransport(
      {
        tx: async (f: (t: unknown) => unknown) =>
          f({ execute: async () => ({ rows: [{ credentials_json: 'enc', meta_json: null }] }) }),
      } as never,
      { decrypt: () => JSON.stringify({ access_token: 't', phone_number_id: '1' }) } as never,
      provider,
    );
    const open = await t.open(1, { id: 1 } as never);
    await expect(
      open.send({ type: 'media', to: '+1', mediaUrl: 'http://x.test/a.jpg' }, {
        clientReference: 'c',
      } as never),
    ).rejects.toThrow('public https link');
    expect(fn).not.toHaveBeenCalled();
  });
});
