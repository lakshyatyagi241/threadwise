import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BotPublishError,
  sanitizeRemoteText,
  type BotConsoleCredentials,
} from '../../../src/infra/providers/flow-builder-editor/bot-publish.port';
import {
  GetaConsoleBotPublisher,
  appIdHeader,
} from '../../../src/infra/providers/flow-builder-editor/geta-console-bot-publisher';
import { GetaConsoleStub } from '../../fixtures/geta-console/stub-server';

/**
 * The HTTP adapter against a local stub of the Geta console. Everything here is fake: no real token, no real bot, and the real
 * sandbox is never called. The stub records the request bytes, so the headers, the `appid` shape and the body are checked as sent.
 */
const FAKE_AUTH = 'fake-auth-token-AAAA1111';
const FAKE_HOST = 'fake-geta-host-BBBB2222';
const BOT_ID = '00000000-0000-4000-8000-000000000001';
const CHATBOT_ID = 'fakeBot1';

const stub = new GetaConsoleStub();
let creds: BotConsoleCredentials;
const sleeps: number[] = [];

const adapter = (over: Partial<ConstructorParameters<typeof GetaConsoleBotPublisher>[0]> = {}) =>
  new GetaConsoleBotPublisher({
    timeoutMs: 2_000,
    maxAttempts: 3,
    backoffMs: 10,
    allowPrivate: true,
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  });

beforeAll(async () => {
  await stub.start();
});
afterAll(async () => {
  await stub.stop();
});
beforeEach(() => {
  stub.reset();
  sleeps.length = 0;
  creds = { baseUrl: stub.url, authorization: FAKE_AUTH, getaHost: FAKE_HOST, origin: null };
});

describe('publish-bot request', () => {
  it('sends exactly the documented method, path, headers and an empty JSON object', async () => {
    const res = await adapter().publishBot(creds, { botId: BOT_ID });
    expect(res.status).toBe(200);
    expect(stub.requests).toHaveLength(1);
    const r = stub.requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.path).toBe('/api/v1/console/publish-bot');
    expect(r.body).toBe('{}');
    expect(r.headers.accept).toBe('application/json');
    expect(r.headers['content-type']).toBe('application/json;charset=UTF-8');
    expect(r.headers.appid).toBe(`{"botid":"${BOT_ID}"}`);
    expect(JSON.parse(r.headers.appid as string)).toEqual({ botid: BOT_ID });
    // sent as-is: no "Bearer " prefix is added
    expect(r.headers.authorization).toBe(FAKE_AUTH);
    expect(r.headers['geta-host']).toBe(FAKE_HOST);
    expect(r.headers.origin).toBeUndefined();
    expect(r.headers.referer).toBeUndefined();
  });

  it('builds the appid header as a JSON string with a single botid key', () => {
    expect(appIdHeader('abc')).toBe('{"botid":"abc"}');
    expect(Object.keys(JSON.parse(appIdHeader('x')))).toEqual(['botid']);
  });

  it('sends origin and referer only when an origin is configured', async () => {
    await adapter().publishBot(
      { ...creds, origin: 'https://console.example.test' },
      { botId: BOT_ID },
    );
    const h = stub.requests[0]!.headers;
    expect(h.origin).toBe('https://console.example.test');
    expect(h.referer).toBe('https://console.example.test/');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    await adapter().publishBot({ ...creds, baseUrl: `${stub.url}/` }, { botId: BOT_ID });
    expect(stub.requests[0]!.path).toBe('/api/v1/console/publish-bot');
  });
});

describe('configuration update request', () => {
  const chatbot = {
    id: CHATBOT_ID,
    bot_id: BOT_ID,
    name: 'Fake bot \u{1F916} फेक बॉट',
    description: 'नमस्कार \u{1F600} fake',
    chatbot_status: false,
    multi_lingual: { display_language_option: false, display_message: '', multi_lingual: false },
    deleted_time: null,
  };

  it('PUTs {"chatbot": ...} to the chatbot path with the shared headers and no appid', async () => {
    await adapter().updateChatbotConfiguration(creds, { chatbotId: CHATBOT_ID, chatbot });
    const r = stub.requests[0]!;
    expect(r.method).toBe('PUT');
    expect(r.path).toBe(`/api/v1/chatbot/${CHATBOT_ID}/configuration/update/`);
    expect(r.headers.accept).toBe('application/json');
    expect(r.headers['content-type']).toBe('application/json;charset=UTF-8');
    expect(r.headers.authorization).toBe(FAKE_AUTH);
    expect(r.headers['geta-host']).toBe(FAKE_HOST);
    expect(r.headers.appid).toBeUndefined();
    expect(JSON.parse(r.body)).toEqual({ chatbot });
  });

  it('round-trips emoji and Devanagari text as UTF-8 with an honest content-length', async () => {
    await adapter().updateChatbotConfiguration(creds, { chatbotId: CHATBOT_ID, chatbot });
    const r = stub.requests[0]!;
    const parsed = JSON.parse(r.rawBody.toString('utf8')) as { chatbot: typeof chatbot };
    expect(parsed.chatbot.name).toBe(chatbot.name);
    expect(parsed.chatbot.description).toBe(chatbot.description);
    expect(r.headers['content-length']).toBe(String(r.rawBody.length));
    // the bytes are real UTF-8, not escaped and not Latin-1
    expect(r.rawBody.includes(Buffer.from('\u{1F916}', 'utf8'))).toBe(true);
  });

  it('keeps null values and the record untouched (nothing added or dropped)', async () => {
    await adapter().updateChatbotConfiguration(creds, { chatbotId: CHATBOT_ID, chatbot });
    const sent = (JSON.parse(stub.requests[0]!.body) as { chatbot: Record<string, unknown> })
      .chatbot;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(chatbot).sort());
    expect(sent.deleted_time).toBeNull();
    expect(sent.chatbot_status).toBe(false);
  });

  it('percent-encodes an odd chatbot id in the path', async () => {
    await adapter().updateChatbotConfiguration(creds, { chatbotId: 'a b/c', chatbot });
    expect(stub.requests[0]!.path).toBe('/api/v1/chatbot/a%20b%2Fc/configuration/update/');
  });
});

describe('retries', () => {
  it('retries a 5xx with doubling backoff and succeeds', async () => {
    stub.enqueue('publish', { status: 503, body: 'down' }, { status: 502, body: 'bad gateway' });
    const res = await adapter({ backoffMs: 100 }).publishBot(creds, { botId: BOT_ID });
    expect(res.status).toBe(200);
    expect(stub.calls('publish')).toHaveLength(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('retries a 429 and honours a small Retry-After', async () => {
    stub.enqueue('update', { status: 429, headers: { 'retry-after': '2' } });
    await adapter().updateChatbotConfiguration(creds, {
      chatbotId: CHATBOT_ID,
      chatbot: { id: CHATBOT_ID, bot_id: BOT_ID },
    });
    expect(stub.calls('update')).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('gives up after maxAttempts and reports the status', async () => {
    stub.setDefault('publish', { status: 500, body: 'boom' });
    const err = await adapter()
      .publishBot(creds, { botId: BOT_ID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BotPublishError);
    const e = err as BotPublishError;
    expect(e.step).toBe('publish_bot');
    expect(e.detail.status).toBe(500);
    expect(e.message).toBe('Geta answered 500: boom (publish)');
    expect(stub.calls('publish')).toHaveLength(3);
  });

  it('never retries another 4xx', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      stub.reset();
      stub.setDefault('publish', { status, body: '{"detail":"nope"}' });
      const err = (await adapter()
        .publishBot(creds, { botId: BOT_ID })
        .catch((e: unknown) => e)) as BotPublishError;
      expect(err.detail.status).toBe(status);
      expect(stub.calls('publish'), String(status)).toHaveLength(1);
    }
  });

  it('does not follow a redirect and treats it as a final failure', async () => {
    stub.setDefault('publish', { status: 302, headers: { location: 'http://127.0.0.1:1/x' } });
    const err = (await adapter()
      .publishBot(creds, { botId: BOT_ID })
      .catch((e: unknown) => e)) as BotPublishError;
    expect(err.detail.status).toBe(302);
    expect(stub.calls('publish')).toHaveLength(1);
  });

  it('retries a network error, then reports that Geta could not be reached', async () => {
    const dead = { ...creds, baseUrl: 'http://127.0.0.1:1' };
    const err = (await adapter()
      .publishBot(dead, { botId: BOT_ID })
      .catch((e: unknown) => e)) as BotPublishError;
    expect(err).toBeInstanceOf(BotPublishError);
    expect(err.message).toMatch(/^Could not reach Geta: .+ \(publish\)$/);
    expect(err.detail.status).toBeUndefined();
    expect(sleeps).toHaveLength(2);
  });

  it('times out a slow console and retries', async () => {
    stub.enqueue('publish', { status: 200, delayMs: 400 });
    const res = await adapter({ timeoutMs: 100 }).publishBot(creds, { botId: BOT_ID });
    expect(res.status).toBe(200);
    expect(stub.calls('publish')).toHaveLength(2);
  });

  it('with maxAttempts 1 never retries', async () => {
    stub.setDefault('publish', { status: 503 });
    await adapter({ maxAttempts: 1 })
      .publishBot(creds, { botId: BOT_ID })
      .catch(() => undefined);
    expect(stub.calls('publish')).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('secrets and error text', () => {
  it('cuts a long response body and never lets a token echoed by the console through', async () => {
    const echo = `denied for ${FAKE_AUTH} / ${FAKE_HOST} ${'x'.repeat(2000)}`;
    stub.setDefault('publish', { status: 403, body: echo });
    const err = (await adapter()
      .publishBot(creds, { botId: BOT_ID })
      .catch((e: unknown) => e)) as BotPublishError;
    expect(err.message.length).toBeLessThan(400);
    expect(err.message).toContain('***');
    expect(err.message).not.toContain(FAKE_AUTH);
    expect(err.message).not.toContain(FAKE_HOST);
    expect(JSON.stringify(err)).not.toContain(FAKE_AUTH);
  });

  it('redacts a token that appears in pieces (Bearer-style values)', () => {
    const text = sanitizeRemoteText('token abcdefghijkl was rejected', ['Bearer abcdefghijkl']);
    expect(text).toBe('token *** was rejected');
  });

  it('collapses control characters and whitespace', () => {
    expect(sanitizeRemoteText('a\r\n\tb\u0000   c')).toBe('a b c');
  });

  it('writes nothing to stdout or stderr, on success or failure', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errOut = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await adapter().publishBot(creds, { botId: BOT_ID });
      stub.setDefault('publish', { status: 400, body: FAKE_AUTH });
      await adapter()
        .publishBot(creds, { botId: BOT_ID })
        .catch(() => undefined);
      const written = [...out.mock.calls, ...errOut.mock.calls].map((c) => String(c[0])).join('');
      expect(written).not.toContain(FAKE_AUTH);
      expect(written).not.toContain(FAKE_HOST);
    } finally {
      out.mockRestore();
      errOut.mockRestore();
    }
  });

  it('refuses a private address unless the deployment allows it', async () => {
    const err = (await adapter({ allowPrivate: false })
      .publishBot(creds, { botId: BOT_ID })
      .catch((e: unknown) => e)) as BotPublishError;
    expect(err).toBeInstanceOf(BotPublishError);
    expect(err.message).toContain('private networks');
    expect(stub.requests).toHaveLength(0);
  });
});
