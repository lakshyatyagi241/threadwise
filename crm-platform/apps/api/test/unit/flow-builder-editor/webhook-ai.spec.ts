import { describe, expect, it } from 'vitest';
import { FLB_NODE_TYPES } from '@crm/contracts';
import {
  CALL_PROMPT_NODE_TYPES,
  CALL_SYSTEM_PROMPT,
  CHAT_PROMPT_NODE_TYPES,
  CHAT_SYSTEM_PROMPT,
  extractFlowJson,
} from '../../../src/modules/flow-builder-editor/flow-ai-prompts';
import { guardSsrf, isPublicIp } from '../../../src/modules/flow-builder-editor/ssrf-guard';
import {
  TestWebhookService,
  substitute,
} from '../../../src/modules/flow-builder-editor/test-webhook.service';
import { HttpFlowAiAdapter } from '../../../src/infra/providers/flow-builder-editor/http-flow-ai.adapter';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

describe('SSRF guard (WD-FLB-024 rule 7)', () => {
  it('classifies private, loopback, link-local, reserved and multicast addresses as not public', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.5',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      'ff02::1',
      '::ffff:10.0.0.1',
      '2001:db8::1',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of [
      '93.184.216.34',
      '8.8.8.8',
      '172.32.0.1',
      '1.1.1.1',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it('refuses a metadata endpoint literal with the exact WaDesk message', async () => {
    const v = await guardSsrf('http://169.254.169.254/x', async () => PUBLIC);
    expect(v).toEqual({
      ok: false,
      reason: 'host resolves to a private/reserved IP (169.254.169.254)',
    });
  });

  it('refuses a name that resolves to a private address, any one of several', async () => {
    const v = await guardSsrf('https://evil.test/a', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    expect(v).toEqual({ ok: false, reason: 'host resolves to a private/reserved IP (10.1.2.3)' });
  });

  it('refuses metadata host names and .internal, other schemes, unparsable URLs and unresolvable hosts', async () => {
    expect(await guardSsrf('http://metadata.google.internal/', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'metadata host not allowed',
    });
    expect(await guardSsrf('http://db.internal/', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'metadata host not allowed',
    });
    expect(await guardSsrf('ftp://example.com/', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'scheme ftp not allowed (use http or https)',
    });
    expect(await guardSsrf('not a url', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'invalid URL',
    });
    expect(await guardSsrf('javascript:alert(1)', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'invalid URL',
    });
    expect(await guardSsrf('mailto:a@b.c', async () => PUBLIC)).toEqual({
      ok: false,
      reason: 'invalid URL',
    });
    expect(await guardSsrf('http://nowhere.test/', async () => [])).toEqual({
      ok: false,
      reason: 'hostname did not resolve to a public IP',
    });
    expect(
      await guardSsrf('http://nowhere.test/', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toEqual({ ok: false, reason: 'hostname did not resolve to a public IP' });
  });

  it('returns the checked address so the request connects to it, not to the name again (rebinding window closed)', async () => {
    const v = await guardSsrf('https://api.example.com:8443/path?q=1', async () => PUBLIC);
    expect(v).toMatchObject({ ok: true, address: '93.184.216.34', family: 4 });
  });
});

describe('webhook test request (WD-FLB-024 rule 6)', () => {
  it('substitutes {{ var }} with spaces and dotted keys; an unset name becomes empty, as in WaDesk', () => {
    expect(
      substitute('Hi {{ name }} {{response.id}} [{{nope}}]', { name: 'Sam', 'response.id': 7 }),
    ).toBe('Hi Sam 7 []');
    expect(substitute('{{o}}', { o: { a: 1 } })).toBe('{"a":1}');
    expect(substitute('[{{ a b }}]{{x}}', { 'a b': 1, x: null })).toBe('[1]');
    expect(substitute('', {})).toBe('');
  });

  class Fake extends TestWebhookService {
    calls: Array<{ method: string; headers: Record<string, string>; body: string; url: string }> =
      [];
    reply: { status: number; headers: Record<string, string>; text: string } = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      text: '{"id":5,"ok":true}',
    };
    protected override send(
      v: { url: URL; address: string; family: 4 | 6 },
      method: string,
      headers: Record<string, string>,
      body: string,
    ) {
      this.calls.push({ method, headers, body, url: v.url.href });
      return Promise.resolve(this.reply);
    }
  }
  const svc = () => {
    const s = new Fake();
    s.resolver = async () => PUBLIC;
    return s;
  };

  it('no URL is a soft failure the chat log can show', async () => {
    expect(await svc().run({ url: '  ' })).toEqual({
      ok: false,
      error: 'No URL configured on the webhook node.',
    });
  });

  it('a private destination is Blocked with the reason', async () => {
    const s = svc();
    s.resolver = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await s.run({ url: 'http://intranet.test/x' })).toEqual({
      ok: false,
      error: 'Blocked: host resolves to a private/reserved IP (10.0.0.5)',
    });
    expect(s.calls).toHaveLength(0);
  });

  it('method falls back to POST, GET and HEAD send no body, custom headers need a key, JSON is returned decoded', async () => {
    const s = svc();
    const r = await s.run({
      url: 'https://api.example.com/{{path}}',
      method: 'TRACE',
      body: '{"n":"{{ name }}"}',
      contentType: 'application/json',
      headers: [
        { key: 'X-A', value: '{{name}}' },
        { key: '  ', value: 'dropped' },
      ],
      vars: { path: 'v1', name: 'Anya' },
    });
    expect(s.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/v1',
      body: '{"n":"Anya"}',
    });
    expect(s.calls[0]!.headers).toMatchObject({
      'X-A': 'Anya',
      'Content-Type': 'application/json',
    });
    expect(Object.keys(s.calls[0]!.headers)).not.toContain('  ');
    expect(r).toMatchObject({ ok: true, status: 200, success: true, json: { id: 5, ok: true } });

    await s.run({ url: 'https://api.example.com/', method: 'get', body: 'ignored' });
    expect(s.calls[1]).toMatchObject({ method: 'GET', body: '' });
  });

  it('Content-Type defaults to JSON; a body goes out with the node type; custom headers replace it in any casing', async () => {
    const s = svc();
    await s.run({ url: 'https://api.example.com/', body: '{}' });
    expect(s.calls[0]!.headers['Content-Type']).toBe('application/json');
    await s.run({ url: 'https://api.example.com/', method: 'GET' });
    expect(s.calls[1]!.headers['Content-Type']).toBe('application/json');
    await s.run({
      url: 'https://api.example.com/',
      contentType: 'text/xml',
      body: '<a/>',
      headers: [{ key: 'content-type', value: 'x/y' }],
    });
    expect(s.calls[2]!.headers).toMatchObject({
      'Content-Type': 'text/xml',
      'Content-Length': '4',
    });
    expect(
      Object.keys(s.calls[2]!.headers).filter((k) => k.toLowerCase() === 'content-type'),
    ).toHaveLength(1);
    await s.run({
      url: 'https://api.example.com/',
      method: 'GET',
      headers: [{ key: 'content-type', value: 'x/y' }],
    });
    expect(s.calls[3]!.headers).toEqual({
      'User-Agent': 'WaDesk-FlowTest/1.0',
      'content-type': 'x/y',
    });
  });

  it('an unset variable in the URL, body and header values becomes empty', async () => {
    const s = svc();
    await s.run({
      url: 'https://api.example.com/{{p}}x',
      body: '[{{ missing }}]',
      headers: [{ key: 'X-T', value: '{{nope}}' }],
      vars: {},
    });
    expect(s.calls[0]).toMatchObject({ url: 'https://api.example.com/x', body: '[]' });
    expect(s.calls[0]!.headers['X-T']).toBe('');
  });

  it('a non-2xx answer is ok:true with success:false; the response text is cut at 4000 characters; arrays flatten by index', async () => {
    const s = svc();
    s.reply = { status: 500, headers: { 'content-type': 'text/plain' }, text: 'x'.repeat(9000) };
    const r = await s.run({ url: 'https://api.example.com/' });
    expect(r).toMatchObject({ ok: true, status: 500, success: false, json: null });
    expect((r as { response: string }).response).toHaveLength(4000);

    s.reply = {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      text: '["a","b"]',
    };
    expect(await s.run({ url: 'https://api.example.com/' })).toMatchObject({
      json: { '0': 'a', '1': 'b' },
    });
  });

  it('a transport failure is { ok:false, error: "Request failed: ..." } cut at 200 characters', async () => {
    const s = svc();
    (s as unknown as { send: () => Promise<never> }).send = () =>
      Promise.reject(new Error('boom '.repeat(100)));
    const r = await s.run({ url: 'https://api.example.com/' });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error.startsWith('Request failed: boom')).toBe(true);
    expect((r as { error: string }).error.length).toBeLessThanOrEqual(
      'Request failed: '.length + 200,
    );
  });
});

describe('AI flow generator (WD-FLB-025)', () => {
  it('strips code fences and surrounding prose and finds the outermost object', () => {
    const raw =
      'Here is your flow:\n```json\n{"flowNodes":[{"id":"n_a","type":"trigger"}],"flowEdges":[]}\n```\nEnjoy!';
    expect(extractFlowJson(raw)).toEqual({
      flowNodes: [{ id: 'n_a', type: 'trigger' }],
      flowEdges: [],
    });
  });

  it('is null for prose, broken JSON, or an object without a flowNodes array; edges default to []', () => {
    expect(extractFlowJson('no json here')).toBeNull();
    expect(extractFlowJson('{"flowNodes": [')).toBeNull();
    expect(extractFlowJson('{"flowNodes": "x"}')).toBeNull();
    expect(extractFlowJson('{"flowNodes": []}')).toEqual({ flowNodes: [], flowEdges: [] });
  });

  it('every node type the prompts teach exists in the catalogue and runs on the channel the prompt is for', () => {
    for (const t of CHAT_PROMPT_NODE_TYPES) {
      expect(FLB_NODE_TYPES[t], t).toBeDefined();
      expect(CHAT_SYSTEM_PROMPT).toContain(`${t}:`);
      expect(FLB_NODE_TYPES[t]!.modes).toContain('chat');
    }
    for (const t of CALL_PROMPT_NODE_TYPES) {
      expect(FLB_NODE_TYPES[t], t).toBeDefined();
      expect(CALL_SYSTEM_PROMPT).toContain(`${t}:`);
      expect(FLB_NODE_TYPES[t]!.modes).toContain('call');
    }
  });

  it('the chat prompt does not teach voice or channel nodes; the call prompt forbids chat nodes', () => {
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/cf_|ig_|fb_/);
    expect(CALL_SYSTEM_PROMPT).toMatch(/do NOT use chat nodes/i);
  });

  it('the HTTP adapter reads each vendor reply shape and surfaces a non-2xx as an error', async () => {
    const reply = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const adapter = new HttpFlowAiAdapter();
    const base = {
      model: 'm',
      apiKey: 'k',
      system: 's',
      prompt: 'p',
      maxTokens: 10,
      temperature: 0,
      json: true,
    };

    adapter.fetchImpl = reply({ choices: [{ message: { content: 'OPENAI' } }] });
    expect(await adapter.generate({ ...base, provider: 'openai' })).toBe('OPENAI');
    adapter.fetchImpl = reply({ content: [{ type: 'text', text: 'CLAUDE' }] });
    expect(await adapter.generate({ ...base, provider: 'anthropic' })).toBe('CLAUDE');
    adapter.fetchImpl = reply({
      candidates: [{ content: { parts: [{ text: 'GEM' }, { text: 'INI' }] } }],
    });
    expect(await adapter.generate({ ...base, provider: 'gemini' })).toBe('GEMINI');
    adapter.fetchImpl = reply({}, 200);
    expect(await adapter.generate({ ...base, provider: 'openai' })).toBeNull();
    adapter.fetchImpl = reply({ error: 'bad key' }, 401);
    await expect(adapter.generate({ ...base, provider: 'openai' })).rejects.toThrow('HTTP 401');
  });

  it('sends the key in the vendor header, never in the URL, and asks for JSON mode', async () => {
    const seen: Array<{
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }> = [];
    const adapter = new HttpFlowAiAdapter();
    adapter.fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'x' } }], candidates: [] }),
      );
    }) as unknown as typeof fetch;
    const base = {
      model: 'm',
      apiKey: 'SECRET',
      system: 's',
      prompt: 'p',
      maxTokens: 10,
      temperature: 0.4,
      json: true,
    };
    await adapter.generate({ ...base, provider: 'openai' });
    await adapter.generate({ ...base, provider: 'gemini' });
    expect(seen[0]!.headers.Authorization).toBe('Bearer SECRET');
    expect(seen[0]!.body.response_format).toEqual({ type: 'json_object' });
    expect(seen[1]!.url).not.toContain('SECRET');
    expect(seen[1]!.headers['x-goog-api-key']).toBe('SECRET');
    expect((seen[1]!.body.generationConfig as Record<string, unknown>).responseMimeType).toBe(
      'application/json',
    );
  });
});
