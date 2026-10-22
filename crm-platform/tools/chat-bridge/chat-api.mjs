// Chat REST API as the app: createMessage / updateMessage / createReply, retries + backoff like the webhook sender. Never throws.
import { createAppAuth, hostOverride } from './chat-app-auth.mjs';

// space id from env CHAT_SPACE_<CHANNEL> ("spaces/AAA" or "AAA") or from the existing webhook URL (.../v1/spaces/AAA/messages?key=..)
export function spaceFor(channel, { env = process.env, urls = {} } = {}) {
  const e = env[`CHAT_SPACE_${channel.toUpperCase()}`];
  if (e) return e.startsWith('spaces/') ? e : `spaces/${e}`;
  const m = /\/v1\/(spaces\/[A-Za-z0-9_-]+)\/messages/.exec(urls[channel] ?? '');
  return m ? m[1] : null;
}

export function createChatApi({ env = process.env, urls = {}, fetchImpl = fetch, auth = createAppAuth({ env, fetchImpl }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), metrics, log = () => {}, retries = Number(env.CHAT_RETRIES ?? 3), baseMs = Number(env.CHAT_RETRY_BASE_MS ?? 500) } = {}) {
  const base = hostOverride(env, 'CHAT_API_BASE', 'https://chat.googleapis.com');
  async function call(channel, method, path, body) {
    let status = 0;
    for (let i = 0; i <= retries; i++) {
      let retryAfter = 0;
      try {
        const r = await fetchImpl(`${base}${path}`, { method, headers: { authorization: `Bearer ${await auth()}`, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
        status = r.status;
        if (r.ok) { metrics?.ok(channel); const j = await r.json().catch(() => ({})); return { ok: true, status, name: j.name, thread: j.thread?.name }; }
        retryAfter = Number(r.headers?.get?.('retry-after')) * 1000 || 0;
        if (status !== 429 && status < 500) break;
      } catch (e) { status = 0; log({ evt: 'chat_api_error', channel, code: e?.name === 'TimeoutError' ? 'timeout' : e?.cause?.code ?? 'error' }); }
      if (i < retries) await sleep(Math.min(retryAfter || baseMs * 2 ** i, 10000));
    }
    metrics?.fail(channel, `api_${status}`); log({ evt: 'chat_api_failed', channel, status });
    return { ok: false, status };
  }
  const createMessage = (channel, body, { threadKey } = {}) => {
    const space = spaceFor(channel, { env, urls });
    if (!space) return Promise.resolve({ ok: false, status: 0 });
    const q = threadKey ? `?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` : '';
    return call(channel, 'POST', `/v1/${space}/messages${q}`, threadKey ? { ...body, thread: { threadKey } } : body);
  };
  return {
    createMessage,
    createReply: (channel, body, threadKey) => createMessage(channel, body, { threadKey }),
    updateMessage: (channel, name, body) => /^spaces\/[\w-]+\/messages\/[\w.-]+$/.test(name ?? '') ? call(channel, 'PATCH', `/v1/${name}?updateMask=text,cardsV2`, body) : Promise.resolve({ ok: false, status: 0 }),
  };
}
