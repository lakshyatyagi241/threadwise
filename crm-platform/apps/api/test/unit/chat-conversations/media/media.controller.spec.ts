import { PassThrough, Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../../src/common/context/request-context';
import { CryptoService } from '../../../../src/common/crypto/crypto.service';
import type { ChatMediaStore } from '../../../../src/infra/providers/chat-conversations/media/chat-media.store';
import { MediaTokenService } from '../../../../src/infra/providers/chat-conversations/media/media-token.service';
import { ChatMediaController } from '../../../../src/infra/providers/chat-conversations/media/media.controller';
import type { ChatMediaAccessPolicy } from '../../../../src/infra/providers/chat-conversations/media/media.ports';

const tokens = new MediaTokenService(
  new CryptoService(
    new ConfigService({
      CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    }) as never,
  ),
);
const KEY = 'chat/3/2026/10/a.png';
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: 'r',
  orgId: 3,
  actorType: 'user',
  actorId: 7,
  userId: 7,
  ...over,
});

/** A response that records what the route sets and collects what it streams. */
function fakeRes() {
  const out = new PassThrough();
  const headers: Record<string, string> = {};
  let status = 200;
  const res = Object.assign(out, {
    status(code: number) {
      status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  });
  return {
    res: res as never,
    headers,
    get status() {
      return status;
    },
    body: () =>
      new Promise<string>((r) => {
        let s = '';
        out.on('data', (c) => (s += c));
        out.on('end', () => r(s));
      }),
  };
}

function controller(policy?: ChatMediaAccessPolicy) {
  const store = {
    ownsKey: (orgId: number, key: string) => key.startsWith(`chat/${orgId}/`),
    open: vi.fn(async () => ({
      stream: Readable.from(['bytes']),
      size: 5,
      start: 0,
      end: 4,
      partial: false,
    })),
  };
  return {
    store,
    controller: new ChatMediaController(store as unknown as ChatMediaStore, tokens, policy),
  };
}
const token = (over: Partial<{ key: string; orgId: number; userId: number }> = {}) =>
  tokens.sign({ key: KEY, orgId: 3, userId: 7, name: 'a.png', mime: 'image/png', ...over });
const read = (c: ChatMediaController, tok: string, context = ctx()) => {
  const r = fakeRes();
  return RequestContextStore.run(context, async () => {
    await c.read(tok, { header: () => undefined } as never, r.res);
    return r;
  });
};

describe('ChatMediaController: the access policy hook', () => {
  it('asks the domain policy with the caller and the key, and serves when it agrees', async () => {
    const policy = { canRead: vi.fn(async () => true) };
    const { controller: c } = controller(policy);
    const r = await read(c, token());
    expect(policy.canRead).toHaveBeenCalledWith({ orgId: 3, userId: 7 }, KEY);
    expect(await r.body()).toBe('bytes');
    expect(r.status).toBe(200);
  });

  it('refuses with a plain 404 when the policy says no (the conversation is no longer theirs), before opening the file', async () => {
    const { controller: c, store } = controller({ canRead: async () => false });
    await expect(read(c, token())).rejects.toMatchObject({ status: 404 });
    expect(store.open).not.toHaveBeenCalled();
  });

  it('serves on the workspace and token checks alone when no policy is bound', async () => {
    const { controller: c } = controller();
    expect((await read(c, token())).status).toBe(200);
  });

  it('never reaches the policy for a token that is not for this person or this workspace', async () => {
    const policy = { canRead: vi.fn(async () => true) };
    const { controller: c } = controller(policy);
    await expect(read(c, token({ userId: 8 }))).rejects.toMatchObject({ status: 404 });
    await expect(read(c, token({ orgId: 4, key: 'chat/4/2026/10/a.png' }))).rejects.toMatchObject({
      status: 404,
    });
    await expect(read(c, token({ key: 'chat/9/2026/10/a.png' }))).rejects.toMatchObject({
      status: 404,
    });
    await expect(read(c, 'nonsense')).rejects.toMatchObject({ status: 404 });
    await expect(
      read(c, token(), ctx({ userId: null, actorType: 'partner_agent' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(policy.canRead).not.toHaveBeenCalled();
  });
});
