import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelRuntime } from '../../../src/infra/providers/chat-conversations/channel.port';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations';
import { LineChannelAdapter } from '../../../src/modules/channel-line/line-channel.adapter';
import { LineSenderService } from '../../../src/modules/channel-line/line-sender.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import {
  FakeLine,
  connectChannel,
  delivery,
  deliver,
  textEvent,
  userId,
  type Connected,
} from './support';

/** A reply in a LINE thread: the channel in the thread key sends it, free through the reply token while it is fresh, else by push. */
let h: Harness;
let api: Api;
let sender: LineSenderService;
const fake = new FakeLine();

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  fake.install(h);
  sender = h.app.get(LineSenderService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => fake.reset());

/** A channel whose user has written (so a reply token exists). */
async function threadWith(t: Tenant, u: string): Promise<Connected> {
  const c = await connectChannel(h, api, fake, t);
  await deliver(api, c, delivery(textEvent(u, 'hello')));
  fake.reset();
  return c;
}
const tokenRow = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT meta FROM messages WHERE org_id = $1 AND direction = 'in' ORDER BY id DESC LIMIT 1`,
      [orgId],
    )
  ).rows[0].meta.line;

describe('a reply leaves from the channel that carried the thread', () => {
  it('uses the free reply path with the fresh reply token, once; the next reply is a push', async () => {
    const t = await api.signup('ls1');
    const u = userId(1);
    const c = await threadWith(t, u);
    const first = await sender.reply(t.orgId, { channelRowId: c.rowId, to: u, text: 'Hello' });
    expect(first).toEqual({ ok: true, providerMessageId: '6001', error: null, status: 200 });
    expect(fake.of('reply')).toHaveLength(1);
    expect(fake.of('reply')[0]).toMatchObject({ token: c.accessToken });
    expect(fake.of('reply')[0]!.args[0]).toMatch(/^reply-token-/);
    expect(fake.of('reply')[0]!.args[1]).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(fake.of('push')).toHaveLength(0);
    // The token is single use: it is gone from the message.
    expect((await tokenRow(t.orgId)).reply_token).toBeUndefined();

    const second = await sender.reply(t.orgId, { channelRowId: c.rowId, to: u, text: 'Again' });
    expect(second).toMatchObject({ ok: true, providerMessageId: '5001' });
    expect(fake.of('push')).toHaveLength(1);
    expect(fake.of('push')[0]!.args).toEqual([u, [{ type: 'text', text: 'Again' }]]);
  });

  it('a reply token older than 55 seconds is not used', async () => {
    const t = await api.signup('ls2');
    const u = userId(2);
    const c = await threadWith(t, u);
    await h.owner.query(
      `UPDATE messages SET meta = jsonb_set(meta, '{line,reply_token_at}', to_jsonb(extract(epoch FROM now())::bigint - 120)) WHERE org_id = $1`,
      [t.orgId],
    );
    await sender.reply(t.orgId, { channelRowId: c.rowId, to: u, text: 'late' });
    expect(fake.of('reply')).toHaveLength(0);
    expect(fake.of('push')).toHaveLength(1);
  });

  it('a reply token LINE no longer accepts falls back to a push; a refusal of the push comes back as the reason', async () => {
    const t = await api.signup('ls3');
    const u = userId(3);
    const c = await threadWith(t, u);
    fake.reply = () => ({ ok: false, status: 400, error: 'Invalid reply token' });
    const sent = await sender.reply(t.orgId, { channelRowId: c.rowId, to: u, text: 'x' });
    expect(sent.ok).toBe(true);
    expect(fake.of('reply')).toHaveLength(1);
    expect(fake.of('push')).toHaveLength(1);

    fake.push = () => ({ ok: false, status: 400, error: 'The user has blocked the account' });
    expect(await sender.reply(t.orgId, { channelRowId: c.rowId, to: u, text: 'y' })).toEqual({
      ok: false,
      providerMessageId: null,
      error: 'The user has blocked the account',
      status: 400,
    });
  });

  it('only the latest message of that person offers a token: another person has none', async () => {
    const t = await api.signup('ls4');
    const c = await threadWith(t, userId(4));
    await sender.reply(t.orgId, { channelRowId: c.rowId, to: userId(5), text: 'cold' });
    expect(fake.of('reply')).toHaveLength(0);
    expect(fake.of('push')[0]!.args[0]).toBe(userId(5));
  });

  it("a removed channel and another workspace's channel both fail without a LINE call", async () => {
    const t = await api.signup('ls5');
    const u = await api.signup('ls5b');
    const gone = await connectChannel(h, api, fake, t);
    const other = await connectChannel(h, api, fake, u);
    await h.owner.query(`DELETE FROM line_channels WHERE id = $1`, [gone.rowId]);
    fake.reset();
    expect(
      await sender.reply(t.orgId, { channelRowId: gone.rowId, to: 'Uabc', text: 'x' }),
    ).toMatchObject({
      ok: false,
      error: 'LINE channel not connected',
    });
    expect(
      await sender.reply(t.orgId, { channelRowId: other.rowId, to: 'Uabc', text: 'x' }),
    ).toMatchObject({
      ok: false,
      error: 'LINE channel not connected',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('a file goes as its own bubble after the caption; a group is answered by its id', async () => {
    const t = await api.signup('ls6');
    const c = await connectChannel(h, api, fake, t);
    await sender.reply(t.orgId, {
      channelRowId: c.rowId,
      to: 'Cgroup0001',
      text: 'Look',
      media: { url: 'http://cdn.example.com/a.png', kind: 'image' },
    });
    expect(fake.of('push')[0]!.args).toEqual([
      'Cgroup0001',
      [
        { type: 'text', text: 'Look' },
        {
          type: 'image',
          originalContentUrl: 'https://cdn.example.com/a.png',
          previewImageUrl: 'https://cdn.example.com/a.png',
        },
      ],
    ]);
  });
});

describe('the inbox adapter', () => {
  const runtime = (orgId: number, c: Connected): ChannelRuntime => ({
    orgId,
    uuid: 'channel-uuid',
    kind: 'line',
    status: 'connected',
    externalId: String(c.rowId),
    displayAddress: c.basicId,
    settings: {} as ChannelRuntime['settings'],
    capabilityOverrides: {},
    credentials: {},
  });
  const envelope = (to: string, over: object = {}) =>
    ({ to, clientReference: 'ref-1', attempt: 1, kind: 'text', body: 'Hello', ...over }) as never;

  it('is registered, live and free of the 24 hour rule', () => {
    const adapter = h.app.get(ChannelAdapterRegistry).for('line');
    expect(adapter).toBeInstanceOf(LineChannelAdapter);
    expect(adapter.live).toBe(true);
    expect(adapter.capabilities(runtime(1, { rowId: 1 } as Connected)).windowHours).toBeNull();
    expect(adapter.windowInfo(runtime(1, { rowId: 1 } as Connected), null, new Date()).open).toBe(
      true,
    );
    expect(adapter.verifyInbound(runtime(1, { rowId: 1 } as Connected), Buffer.alloc(0), {})).toBe(
      false,
    );
  });

  it('sends text through the channel and returns LINE message id', async () => {
    const t = await api.signup('la1');
    const c = await connectChannel(h, api, fake, t);
    const adapter = h.app.get(ChannelAdapterRegistry).for('line');
    const out = await adapter.send(runtime(t.orgId, c), envelope('Uabc'));
    expect(out.providerMessageId).toBe('5001');
    expect(fake.of('push')[0]!.args).toEqual(['Uabc', [{ type: 'text', text: 'Hello' }]]);
  });

  it('turns a refusal into a non-retryable error, a rate limit into a retryable one, a gone channel into a disconnect', async () => {
    const t = await api.signup('la2');
    const c = await connectChannel(h, api, fake, t);
    const adapter = h.app.get(ChannelAdapterRegistry).for('line');
    fake.push = () => ({ ok: false, status: 400, error: 'Bad request' });
    await expect(adapter.send(runtime(t.orgId, c), envelope('Uabc'))).rejects.toMatchObject({
      code: 'LINE_SEND_REJECTED',
      retryable: false,
    });
    fake.push = () => ({ ok: false, status: 429, error: 'Too many requests' });
    await expect(adapter.send(runtime(t.orgId, c), envelope('Uabc'))).rejects.toMatchObject({
      code: 'LINE_SEND_REJECTED',
      retryable: true,
    });
    await h.owner.query(`DELETE FROM line_channels WHERE id = $1`, [c.rowId]);
    await expect(adapter.send(runtime(t.orgId, c), envelope('Uabc'))).rejects.toMatchObject({
      code: 'CHANNEL_DISCONNECTED',
    });
    await expect(
      adapter.send({ ...runtime(t.orgId, c), externalId: null }, envelope('Uabc')),
    ).rejects.toMatchObject({ code: 'CHANNEL_DISCONNECTED' });
  });

  it('refuses what LINE has no message for, and a file it cannot reach by link', async () => {
    const t = await api.signup('la3');
    const c = await connectChannel(h, api, fake, t);
    const adapter = h.app.get(ChannelAdapterRegistry).for('line');
    await expect(
      adapter.send(
        runtime(t.orgId, c),
        envelope('Uabc', { kind: 'reaction', reaction: { providerMessageId: 'x', emoji: '👍' } }),
      ),
    ).rejects.toMatchObject({ code: 'CHANNEL_CAPABILITY_UNSUPPORTED' });
    const media = envelope('Uabc', {
      kind: 'media',
      media: {
        key: `chat/${t.orgId}/a.png`,
        mediaKind: 'image',
        mime: 'image/png',
        caption: 'Look',
      },
    });
    // Local-disk storage has no public link LINE could fetch.
    await expect(adapter.send(runtime(t.orgId, c), media)).rejects.toMatchObject({
      code: 'MEDIA_NOT_REACHABLE',
    });
    expect(fake.of('push')).toHaveLength(0);

    // With a cloud bucket the signed link is what LINE is given.
    (adapter as unknown as { media: unknown }).media = {
      temporaryPublicLink: () =>
        Promise.resolve({ url: 'https://bucket.example.com/a.png?sig=1', expiresAt: new Date() }),
    };
    await adapter.send(runtime(t.orgId, c), media);
    expect(fake.of('push')[0]!.args).toEqual([
      'Uabc',
      [
        { type: 'text', text: 'Look' },
        {
          type: 'image',
          originalContentUrl: 'https://bucket.example.com/a.png?sig=1',
          previewImageUrl: 'https://bucket.example.com/a.png?sig=1',
        },
      ],
    ]);
  });
});
