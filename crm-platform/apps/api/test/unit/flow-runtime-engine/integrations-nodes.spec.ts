import { FlowRefResolver } from '../../../src/modules/flow-runtime-engine/runtime/nodes/flow-refs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiCallPort } from '../../../src/infra/providers/flow-runtime-engine/ai-call.port';
import {
  GoogleNotConnectedError,
  type GoogleWorkspacePort,
} from '../../../src/infra/providers/flow-runtime-engine/google-workspace.port';
import { placeUnderHeaders } from '../../../src/infra/providers/flow-runtime-engine/google-workspace.http.adapter';
import { HttpGoogleWorkspace } from '../../../src/infra/providers/flow-runtime-engine/google-workspace.http.adapter';
import type { MysqlQueryPort } from '../../../src/infra/providers/flow-runtime-engine/mysql-query.port';
import { SafeFetch } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  executeCurrent,
  type StepDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import { runUserCode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/code-sandbox';
import { readOnlySql } from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/data-nodes';
import { IntegrationNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/integrations-nodes';
import type {
  InboundReply,
  OutboundMessage,
  RunState,
  SendOutcome,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

// --- a node run the way the engine does it -------------------------------------------------------------------------------------

interface Fakes {
  safeFetch: SafeFetch;
  mysql: MysqlQueryPort;
  google: GoogleWorkspacePort;
  calls: AiCallPort;
}

function newRun(
  type: string,
  data: Record<string, unknown>,
  vars: Record<string, unknown>,
): RunState {
  const graph = compileGraph({
    flowNodes: [
      { id: 'n1', type, data },
      { id: 'n2', type: 'end', data: {} },
      { id: 'n3', type: 'end', data: {} },
    ],
    flowEdges: [
      { source: 'n1', sourceHandle: type === 'google_form' ? 'submitted' : 'out', target: 'n2' },
      ...(type === 'google_form' ? [{ source: 'n1', sourceHandle: 'timeout', target: 'n3' }] : []),
    ],
  });
  return {
    id: 1,
    uuid: 'run-1',
    orgId: 7,
    flowId: 3,
    subscriberId: null,
    contactId: null,
    channelId: 1,
    channelUuid: 'c',
    channelKind: 'simulator',
    contactUuid: null,
    peerKey: '15551234567',
    conversationId: 42,
    source: 'keyword',
    triggerText: null,
    status: 'running',
    graph,
    currentNodeId: 'n1',
    stepSeq: 4,
    vars,
    visits: {},
    wait: null,
    menus: { latest: null, byNode: {} },
    lastOut: null,
    timeoutSeconds: 600,
    cooldownSeconds: 0,
    haltReason: null,
    startedAt: new Date(0),
    expiresAt: null,
    maxExpiresAt: new Date(1e13),
    resumeAt: null,
  };
}

const NOW = new Date('2026-10-03T10:00:00Z');

async function runNode(
  type: string,
  data: Record<string, unknown>,
  fakes: Partial<Fakes> = {},
  vars: Record<string, unknown> = {},
  sendOutcome: SendOutcome = { ok: true },
) {
  const exec = new IntegrationNodes(
    fakes.safeFetch ?? new SafeFetch(),
    fakes.mysql ?? { query: async () => [] },
    fakes.google ?? failingGoogle(),
    fakes.calls ?? { place: async () => ({ ok: true, callId: 'c1' }) },
    new FlowRefResolver({} as never),
  );
  const run = newRun(type, data, vars);
  const sent: OutboundMessage[] = [];
  const deps: StepDeps = {
    send: async (_r, m) => {
      sent.push(m);
      return sendOutcome;
    },
    paceMs: () => 0,
    now: () => NOW,
    executors: [exec],
  };
  const out = await executeCurrent(run, deps);
  return { run, out, sent, exec };
}

const failingGoogle = (): GoogleWorkspacePort => {
  const no = async () => {
    throw new GoogleNotConnectedError();
  };
  return {
    appendSheetRow: no,
    readSheetRows: no,
    generateDoc: no,
    formResponderUrl: no,
    createMeet: no,
  };
};

const goes = (t: { t: string; nodeId?: string }, to: string) =>
  expect(t).toMatchObject({ t: 'goto', nodeId: to });

// --- the sandbox (WD-FLR-033) --------------------------------------------------------------------------------------------------

describe('Code sandbox', () => {
  it('runs the code with the three inputs and returns JSON-safe data', async () => {
    const r = await runUserCode(
      'return { sum: functionArgs.a + allResponses.n, prev: previousResponse };',
      { previousResponse: 'old', allResponses: { n: 2 }, functionArgs: { a: 40 } },
    );
    expect(r).toEqual({ ok: true, error: null, result: { sum: 42, prev: 'old' } });
  });

  it('returns null for no return value and for empty code', async () => {
    expect((await runUserCode('var x = 1;', {})).result).toBeNull();
    expect((await runUserCode('   ', {})).result).toBeNull();
  });

  it('reports a thrown error and a syntax error without throwing', async () => {
    expect(await runUserCode('throw new Error("boom")', {})).toMatchObject({
      ok: false,
      error: 'boom',
    });
    expect((await runUserCode('return (', {})).ok).toBe(false);
  });

  it('cannot reach process, require or the host through the constructor chain', async () => {
    const probes = [
      "return constructor.constructor('return process')()",
      "return this.constructor.constructor('return process')().mainModule",
      "return (function(){}).constructor('return process')()",
      "return [].constructor.constructor('return globalThis.process')()",
      'return typeof require + typeof process + typeof module + typeof Buffer + typeof setTimeout + typeof fetch',
      "return Object.getPrototypeOf(functionArgs).constructor.constructor('return process')()",
    ];
    for (const code of probes) {
      const r = await runUserCode(code, { functionArgs: {} });
      // Either the lookup throws (process is not defined) or it yields only undefined type names; never a host object.
      if (r.ok) expect(r.result === null || /^(undefined)+$/.test(String(r.result))).toBe(true);
      else expect(r.error).toMatch(/not defined|undefined|Cannot read/);
    }
  });

  it('stops an endless synchronous loop at the time limit', async () => {
    const t = Date.now();
    const r = await runUserCode('while(true){}', {}, { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out|time limit/i);
    expect(Date.now() - t).toBeLessThan(2500);
  });

  it('stops an endless loop hidden in a promise callback', async () => {
    const r = await runUserCode(
      'Promise.resolve().then(function(){ while(true){} }); return 1;',
      {},
      { timeoutMs: 300 },
    );
    expect(r.ok).toBe(false);
  });

  it('kills a runaway allocation without taking the process down', async () => {
    const r = await runUserCode(
      'var a=[]; while(true){ a.push(new Array(1e6).fill(1)); }',
      {},
      { timeoutMs: 5000, memoryMb: 16 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/memory|heap|terminated|time/i);
  });
});

describe('Code node', () => {
  it('saves the result and each top-level field, and leaves by the single port', async () => {
    const { run, out } = await runNode(
      'code',
      {
        code: 'return { total: allResponses.price * 2, label: "x" };',
        variable: '@calc',
      },
      {},
      { price: 21 },
    );
    expect(run.vars.calc).toEqual({ total: 42, label: 'x' });
    expect(run.vars['calc.total']).toBe(42);
    goes(out.transition, 'n2');
  });

  it('gives the previous value under the same variable, and the args', async () => {
    const { run } = await runNode(
      'code',
      { code: 'return previousResponse + functionArgs.k;', args: { k: '!' } },
      {},
      { result: 'hi' },
    );
    expect(run.vars.result).toBe('hi!');
  });

  it('saves { ok: false, error } on failure and carries on', async () => {
    const { run, out } = await runNode('code', { code: 'throw new Error("nope")' });
    expect(run.vars.result).toEqual({ ok: false, error: 'nope' });
    expect(run.vars['result.ok']).toBe(false);
    goes(out.transition, 'n2');
  });
});

// --- the Webhook node (WD-FLR-032) ---------------------------------------------------------------------------------------------

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('Webhook node', () => {
  let server: Server;
  let base = '';
  const seen: Seen[] = [];
  let reply: { status: number; body: string; headers?: Record<string, string> } = {
    status: 200,
    body: '{}',
  };
  const localFetch = () => {
    const f = new SafeFetch();
    f.isBlocked = () => false; // the test server is on 127.0.0.1
    return f;
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
        res.end(reply.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('posts the body with variables, adds headers and the context envelope, saves the response flattened', async () => {
    seen.length = 0;
    reply = {
      status: 200,
      body: JSON.stringify({
        price: 9,
        user: { name: 'Ana' },
        items: [{ id: 1 }, { id: 2 }],
        set_user_message: 'hello there',
      }),
    };
    const { run, out } = await runNode(
      'webhook',
      {
        url: `${base}/p?q={{who}}`,
        body: '{"order":"{{item}}"}',
        headers: [{ key: 'X-Key', value: 'k-{{who}}' }],
        variable: 'resp',
      },
      { safeFetch: localFetch() },
      { who: 'ana', item: 'wings' },
    );
    const s = seen[0]!;
    expect(s.method).toBe('POST');
    expect(s.url).toBe('/p?q=ana');
    expect(s.headers['x-key']).toBe('k-ana');
    expect(s.headers['idempotency-key']).toBe('flow:run-1:4:n1');
    const body = JSON.parse(s.body);
    expect(body.order).toBe('wings');
    expect(body._wadesk).toMatchObject({
      customer_phone: '15551234567',
      conversation_id: 42,
      flow_id: 3,
    });
    expect(typeof run.vars.resp).toBe('string');
    expect(run.vars['resp.price']).toBe(9);
    expect(run.vars['resp.user.name']).toBe('Ana');
    expect(run.vars['resp.items.length']).toBe(2);
    expect(run.vars['resp.items.1.id']).toBe(2);
    expect(run.vars.user_message).toBe('hello there');
    goes(out.transition, 'n2');
  });

  it('JSON-escapes variables when the raw body would not parse (a multi-line order)', async () => {
    seen.length = 0;
    reply = { status: 200, body: '{}' };
    await runNode(
      'webhook',
      { url: `${base}/o`, body: '{"text":"{{order}}"}' },
      { safeFetch: localFetch() },
      { order: 'a "b"\n5 wings' },
    );
    expect(JSON.parse(seen[0]!.body).text).toBe('a "b"\n5 wings');
  });

  it('sends GET without a body and a form body as text', async () => {
    seen.length = 0;
    await runNode(
      'webhook',
      { method: 'get', url: `${base}/g`, body: 'ignored' },
      { safeFetch: localFetch() },
    );
    expect(seen[0]).toMatchObject({ method: 'GET', body: '' });
    await runNode(
      'webhook',
      { url: `${base}/f`, contentType: 'application/x-www-form-urlencoded', body: 'a={{v}}' },
      { safeFetch: localFetch() },
      { v: '1' },
    );
    expect(seen[1]!.body).toBe('a=1');
  });

  it('keeps a plain-text response whole', async () => {
    reply = { status: 200, body: 'OK-42' };
    const { run } = await runNode('webhook', { url: `${base}/t` }, { safeFetch: localFetch() });
    expect(run.vars.response).toBe('OK-42');
  });

  it('empties the variable and moves on after a non-2xx, and does not follow a redirect', async () => {
    seen.length = 0;
    reply = { status: 500, body: 'bad' };
    const a = await runNode('webhook', { url: `${base}/e` }, { safeFetch: localFetch() });
    expect(a.run.vars.response).toBe('');
    expect(a.out.notes.join()).toContain('HTTP 500');
    goes(a.out.transition, 'n2');
    seen.length = 0;
    reply = { status: 302, body: '', headers: { location: `${base}/second` } };
    const b = await runNode('webhook', { url: `${base}/r` }, { safeFetch: localFetch() });
    expect(b.run.vars.response).toBe('');
    expect(seen.map((x) => x.url)).toEqual(['/r']);
  });

  it('refuses loopback, private, metadata and non-http targets by default (SSRF) and moves on', async () => {
    for (const url of [
      'http://127.0.0.1:1/x',
      'http://localhost/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/x',
      'http://[::1]/x',
      'http://[::ffff:127.0.0.1]/x',
      'file:///etc/passwd',
      'ftp://example.com/x',
    ]) {
      const r = await runNode('webhook', { url, variable: 'v' });
      expect(r.run.vars.v, url).toBe('');
      expect(r.out.notes.join(), url).toMatch(
        /Blocked|must be http|could not be resolved|not a valid/i,
      );
      goes(r.out.transition, 'n2');
    }
  });

  it('skips a node with no URL', async () => {
    const r = await runNode('webhook', { url: '{{missing}}' });
    expect(r.out.notes.join()).toContain('no URL');
    goes(r.out.transition, 'n2');
  });
});

// --- MySQL (WD-FLR-034) --------------------------------------------------------------------------------------------------------

describe('MySQL node', () => {
  it('accepts one SELECT or WITH and refuses everything else', () => {
    expect(readOnlySql(' SELECT 1; ')).toEqual({ sql: 'SELECT 1' });
    expect(readOnlySql('with a as (select 1) select * from a')).toHaveProperty('sql');
    for (const bad of [
      'DELETE FROM t',
      'SELECT 1; DROP TABLE t',
      'SELECT * INTO OUTFILE "/x" FROM t',
      'SELECT LOAD_FILE("/etc/passwd")',
      'UPDATE t SET a=1',
      `SELECT '${'x'.repeat(8000)}'`,
    ]) {
      expect(readOnlySql(bad), bad.slice(0, 30)).toHaveProperty('error');
    }
  });

  const publicFetch = () => {
    const f = new SafeFetch();
    f.isBlocked = () => false;
    return f;
  };

  it('runs the statement with the node settings, caps and maps the rows to variables', async () => {
    const calls: unknown[] = [];
    const mysql: MysqlQueryPort = {
      query: async (req) => {
        calls.push(req);
        return Array.from({ length: 150 }, (_, i) => ({ id: i, name: `n${i}` }));
      },
    };
    const { run, out } = await runNode(
      'mysql',
      {
        host: '8.8.8.8',
        database: 'shop',
        username: 'u',
        password: 'p',
        sql: 'SELECT * FROM t WHERE id = {{id}}',
        variable: 'rows',
      },
      { mysql, safeFetch: publicFetch() },
      { id: '5' },
    );
    expect(calls[0]).toMatchObject({
      host: '8.8.8.8',
      address: '8.8.8.8',
      port: 3306,
      database: 'shop',
      sql: 'SELECT * FROM t WHERE id = 5',
      maxRows: 100,
    });
    expect(run.vars['rows.length']).toBe(100);
    expect(run.vars['rows.0.name']).toBe('n0');
    expect(JSON.parse(run.vars.rows as string)).toHaveLength(100);
    goes(out.transition, 'n2');
  });

  it('empties the variable and moves on when the guard, the host policy or the driver refuses', async () => {
    const mysql: MysqlQueryPort = {
      query: async () => {
        throw new Error('Access denied');
      },
    };
    const write = await runNode(
      'mysql',
      { host: '8.8.8.8', database: 'd', sql: 'DELETE FROM t' },
      { mysql, safeFetch: publicFetch() },
    );
    expect(write.run.vars.rows).toBe('');
    const internal = await runNode(
      'mysql',
      { host: '127.0.0.1', database: 'd', sql: 'SELECT 1' },
      { mysql },
    );
    expect(internal.run.vars.rows).toBe('');
    expect(internal.out.notes.join()).toMatch(/Blocked/);
    const down = await runNode(
      'mysql',
      { host: '8.8.8.8', database: 'd', sql: 'SELECT 1' },
      { mysql, safeFetch: publicFetch() },
    );
    expect(down.run.vars.rows).toBe('');
    expect(down.out.notes.join()).toContain('Access denied');
    goes(down.out.transition, 'n2');
    const missing = await runNode('mysql', { host: '', database: 'd', sql: 'SELECT 1' }, { mysql });
    expect(missing.out.notes.join()).toContain('skipped');
  });

  it('the default adapter fails with a clear reason when no driver is installed', async () => {
    const { MysqlDriverUnavailable } =
      await import('../../../src/infra/providers/flow-runtime-engine/mysql-query.port');
    const r = await runNode(
      'mysql',
      { host: '8.8.8.8', database: 'd', sql: 'SELECT 1' },
      { mysql: new MysqlDriverUnavailable(), safeFetch: publicFetch() },
    );
    expect(r.out.notes.join()).toContain('driver is not installed');
  });
});

// --- Google nodes (WD-FLR-044 to 047) ------------------------------------------------------------------------------------------

function fakeGoogle() {
  const log = {
    appends: [] as unknown[],
    reads: [] as unknown[],
    docs: [] as unknown[],
    meets: [] as unknown[],
  };
  const g: GoogleWorkspacePort = {
    appendSheetRow: async (_o, r) => void log.appends.push(r),
    readSheetRows: async (_o, r) => {
      log.reads.push(r);
      return r.matchValue === 'CUST-1' ? [{ Name: 'Ana', Phone: '555' }] : [];
    },
    generateDoc: async (_o, r) => {
      log.docs.push(r);
      return { url: 'https://docs.google.com/document/d/abc/edit' };
    },
    formResponderUrl: async (_o, id) => ({
      url: `https://docs.google.com/forms/d/e/${id}/viewform`,
    }),
    createMeet: async (_o, r) => {
      log.meets.push(r);
      return { meetUrl: 'https://meet.google.com/abc-defg-hij', eventId: 'ev1' };
    },
  };
  return { g, log };
}

describe('Google Sheets node', () => {
  it('appends one row from the columns, with system tags and flattened values', async () => {
    const { g, log } = fakeGoogle();
    const { run, out } = await runNode(
      'google_sheets',
      {
        sheetId: 'S1',
        tabName: 'Leads',
        columns: [
          '{{name}}',
          { column: 'When', value: '{{timestamp}}' },
          { column: 'Pick', value: '{{choice}}' },
          { column: 'Blank', value: null },
          '{{tags}}',
        ],
      },
      { google: g },
      { name: 'Ana', choice: { title: 'Pizza', id: 'p1' }, tags: ['a', 'b'], timestamp: 'mine' },
    );
    expect(log.appends[0]).toMatchObject({
      sheetId: 'S1',
      tabName: 'Leads',
      values: ['Ana', 'mine', 'Pizza', '', 'a, b'],
      matchByHeader: false,
    });
    expect(run.vars).not.toHaveProperty('sheet_row');
    goes(out.transition, 'n2');
  });

  it('uses the clock for the system tags when the flow set none', async () => {
    const { g, log } = fakeGoogle();
    await runNode(
      'google_sheets',
      { sheetId: 'S', columns: ['{{timestamp}}', '{{date}}', '{{iso_timestamp}}'] },
      { google: g },
    );
    expect((log.appends[0] as { values: string[] }).values).toEqual([
      '2026-10-03 10:00:00',
      '2026-10-03',
      '2026-10-03T10:00:00.000Z',
    ]);
  });

  it('writes one row per record when an AI node left prefix.__rows', async () => {
    const { g, log } = fakeGoogle();
    await runNode(
      'google_sheets',
      { sheetId: 'S', columns: ['{{order.item}}', '{{order.qty}}'] },
      { google: g },
      {
        'order.__rows': [
          { item: 'wings', qty: 5 },
          { item: 'fries', qty: 2 },
        ],
      },
    );
    expect(log.appends.map((a) => (a as { values: string[] }).values)).toEqual([
      ['wings', '5'],
      ['fries', '2'],
    ]);
  });

  it('passes header mapping through', async () => {
    const { g, log } = fakeGoogle();
    await runNode(
      'google_sheets',
      { sheetId: 'S', matchByHeader: true, columns: [{ header: 'Email', value: '{{e}}' }] },
      { google: g },
      { e: 'a@b.c' },
    );
    expect(log.appends[0]).toMatchObject({
      matchByHeader: true,
      columnHeaders: ['Email'],
      values: ['a@b.c'],
    });
  });

  it('reads a row into the variable and its dotted keys; no match leaves nothing', async () => {
    const { g } = fakeGoogle();
    const hit = await runNode(
      'google_sheets',
      { sheetId: 'S', mode: 'read', matchColumn: 'Id', matchValue: '{{id}}', saveAs: 'cust' },
      { google: g },
      { id: 'CUST-1' },
    );
    expect(hit.run.vars.cust).toEqual({ Name: 'Ana', Phone: '555' });
    expect(hit.run.vars['cust.Name']).toBe('Ana');
    const miss = await runNode(
      'google_sheets',
      { sheetId: 'S', mode: 'read', matchColumn: 'Id', matchValue: 'x' },
      { google: g },
    );
    expect(miss.run.vars).not.toHaveProperty('sheet_row');
    goes(miss.out.transition, 'n2');
  });

  it('moves on with a note when no Google account is connected, or the sheet or columns are missing', async () => {
    const a = await runNode('google_sheets', { sheetId: 'S', columns: ['x'] });
    expect(a.out.notes.join()).toContain('No Google account connected');
    goes(a.out.transition, 'n2');
    expect((await runNode('google_sheets', { columns: ['x'] })).out.notes.join()).toContain(
      'no sheet',
    );
    expect((await runNode('google_sheets', { sheetId: 'S' })).out.notes.join()).toContain(
      'no columns',
    );
    const r = await runNode('google_sheets', { sheetId: 'S', mode: 'read', matchValue: 'a' });
    expect(r.out.notes.join()).toContain('No Google account connected');
  });
});

describe('Google Docs node', () => {
  it('fills the template from the variables and placeholders, saves the link, sends it', async () => {
    const { g, log } = fakeGoogle();
    const { run, sent, out } = await runNode(
      'google_docs',
      {
        templateId: 'T',
        newTitle: 'Invoice {{name}}',
        placeholders: [{ key: 'total', value: '{{amount}} USD' }],
        saveAs: 'mydoc',
      },
      { google: g },
      { name: 'Ana', amount: 10, obj: { a: 1 } },
    );
    expect(log.docs[0]).toMatchObject({
      templateId: 'T',
      newTitle: 'Invoice Ana',
      shareable: true,
      vars: { name: 'Ana', amount: '10', total: '10 USD' },
    });
    expect((log.docs[0] as { vars: object }).vars).not.toHaveProperty('obj');
    expect(run.vars.mydoc).toBe('https://docs.google.com/document/d/abc/edit');
    expect(run.vars.doc_url).toBe(run.vars.mydoc);
    expect(sent).toEqual([
      { kind: 'text', body: "Here's your document: https://docs.google.com/document/d/abc/edit" },
    ]);
    goes(out.transition, 'n2');
  });

  it("sends WaDesk's apology when Google fails, and moves on", async () => {
    const { sent, out } = await runNode('google_docs', { templateId: 'T' });
    expect(sent).toEqual([
      {
        kind: 'text',
        body: "Sorry, couldn't generate your document right now. Please try again later.",
      },
    ]);
    goes(out.transition, 'n2');
  });

  it('skips without a template, and survives a refused send', async () => {
    expect((await runNode('google_docs', {})).sent).toEqual([]);
    const { g } = fakeGoogle();
    const r = await runNode(
      'google_docs',
      { templateId: 'T' },
      { google: g },
      {},
      { ok: false, error: 'down', code: 'x', halt: false },
    );
    goes(r.out.transition, 'n2');
  });
});

describe('Google Meet node', () => {
  it('creates the event after the lead time, saves the variables and sends the message', async () => {
    const { g, log } = fakeGoogle();
    const { run, sent } = await runNode(
      'google_meet',
      { title: 'Call {{name}}', leadMinutes: 10, durationMinutes: 45, sendCalendarInvite: true },
      { google: g },
      { name: 'Ana' },
    );
    const m = log.meets[0] as {
      title: string;
      startAt: Date;
      endAt: Date;
      sendInvites: boolean;
      requestId: string;
    };
    expect(m.title).toBe('Call Ana');
    expect(m.startAt.toISOString()).toBe('2026-10-03T10:10:00.000Z');
    expect(m.endAt.toISOString()).toBe('2026-10-03T10:55:00.000Z');
    expect(m.sendInvites).toBe(true);
    expect(m.requestId).toBe('flow:run-1:4:n1');
    expect(run.vars).toMatchObject({
      meet_link: 'https://meet.google.com/abc-defg-hij',
      meet_start: '2026-10-03 10:10 UTC',
      meet_event_id: 'ev1',
    });
    expect(sent[0]).toEqual({
      kind: 'text',
      body: 'Your meeting link: https://meet.google.com/abc-defg-hij\nStarts at 2026-10-03 10:10 UTC',
    });
  });

  it("sends WaDesk's apology without a link", async () => {
    const { sent, run, out } = await runNode('google_meet', {});
    expect(sent[0]).toEqual({
      kind: 'text',
      body: "Sorry, couldn't generate a meeting link right now. Please try again later.",
    });
    expect(run.vars).not.toHaveProperty('meet_link');
    goes(out.transition, 'n2');
  });
});

describe('Google Form node', () => {
  it('sends the link and parks on a custom wait with an expiry and a timeout port', async () => {
    const { g } = fakeGoogle();
    const { out, sent } = await runNode(
      'google_form',
      { formId: 'F1', bodyText: 'Hi {{name}}', saveAs: 'survey', expiresInSec: 3600 },
      { google: g },
      { name: 'Ana' },
    );
    expect(sent[0]).toEqual({
      kind: 'text',
      body: 'Hi Ana\n\nhttps://docs.google.com/forms/d/e/F1/viewform',
    });
    expect(out.transition).toMatchObject({
      t: 'wait',
      wait: {
        nodeId: 'n1',
        variable: 'survey',
        kind: 'Custom',
        handler: 'GoogleForm',
        data: { formId: 'F1' },
        timeoutSeconds: 3600,
        timeoutPort: 2,
      },
    });
  });

  it('defaults to a day, apologises when the form is unreachable, skips without a form id', async () => {
    const { g } = fakeGoogle();
    const day = await runNode('google_form', { formId: 'F' }, { google: g });
    expect(day.out.transition).toMatchObject({
      wait: { timeoutSeconds: 86_400, variable: 'google_form' },
    });
    const down = await runNode('google_form', { formId: 'F' });
    expect(down.sent[0]).toEqual({
      kind: 'text',
      body: 'Sorry, the form is unavailable right now. Please try again later.',
    });
    goes(down.out.transition, 'n2');
    expect((await runNode('google_form', {})).out.notes.join()).toContain('no form');
  });

  it('a submission saves the answers and routes by submitted; a typed message is ignored', async () => {
    const { g } = fakeGoogle();
    const { run, exec } = await runNode(
      'google_form',
      { formId: 'F', saveAs: 'survey' },
      { google: g },
    );
    run.wait = { nodeId: 'n1', variable: 'survey', kind: 'Custom', handler: 'GoogleForm' };
    const ctx = {
      run,
      node: run.graph.nodes[0]!,
      stepKey: 'k',
      send: async () => ({ ok: true }) as SendOutcome,
      render: (t: unknown) => String(t),
      note: () => undefined,
      now: () => NOW,
    };
    const external: InboundReply = {
      kind: 'external',
      id: '',
      text: '',
      data: { answers: { 'Your name': 'Ana', Toppings: ['a', 'b'], Age: 30 } },
    };
    const d = await exec.onReply(ctx, external);
    expect(d).toMatchObject({ action: 'route', port: 1 });
    const set = (d as { setVars: Record<string, unknown> }).setVars;
    expect(set.survey).toEqual({ 'Your name': 'Ana', Toppings: ['a', 'b'], Age: 30 });
    expect(set['survey.Toppings']).toBe('a, b');
    expect(set['survey.Age']).toBe('30');
    expect(await exec.onReply(ctx, { kind: 'text', id: '', text: 'hello' })).toEqual({
      action: 'ignore',
    });
  });
});

describe('placeUnderHeaders and the Google HTTP adapter', () => {
  it('places values under matching headers and keeps unknown labels after the last column', () => {
    expect(
      placeUnderHeaders(
        ['Name', 'Email', ''],
        [' email ', 'NAME', 'Extra', ''],
        ['e', 'n', 'x', ''],
      ),
    ).toEqual(['n', 'e', '', 'x']);
  });

  it('fails with the not-connected error when there is no token', async () => {
    const g = new HttpGoogleWorkspace({ accessToken: async () => null });
    await expect(
      g.appendSheetRow(1, {
        sheetId: 's',
        tabName: '',
        values: [],
        columnHeaders: [],
        matchByHeader: false,
      }),
    ).rejects.toBeInstanceOf(GoogleNotConnectedError);
  });

  it('calls the Sheets append endpoint with the bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const g = new HttpGoogleWorkspace({ accessToken: async () => 'tok' }, http);
    await g.appendSheetRow(1, {
      sheetId: 'a b',
      tabName: "Ana's",
      values: ['1', '2'],
      columnHeaders: [],
      matchByHeader: false,
    });
    expect(calls[0]!.url).toContain('https://sheets.googleapis.com/v4/spreadsheets/a%20b/values/');
    expect(calls[0]!.url).toContain(encodeURIComponent("'Ana''s'"));
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ values: [['1', '2']] });
  });

  it('reads rows by matching a header', async () => {
    const http = (async () =>
      new Response(
        JSON.stringify({
          values: [
            ['Id', 'Name'],
            ['1', 'Ana'],
            ['2', 'Bo'],
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const g = new HttpGoogleWorkspace({ accessToken: async () => 't' }, http);
    expect(
      await g.readSheetRows(1, {
        sheetId: 's',
        tabName: '',
        matchColumn: 'id',
        matchValue: '2',
        limit: 1,
      }),
    ).toEqual([{ Id: '2', Name: 'Bo' }]);
    expect(
      await g.readSheetRows(1, {
        sheetId: 's',
        tabName: '',
        matchColumn: 'nope',
        matchValue: '2',
        limit: 1,
      }),
    ).toEqual([]);
  });
});

// --- AI voice call (WD-FLR-048) -----------------------------------------------------------------------------------------------

describe('AI voice call node', () => {
  it('places the call with the digits of the contact, the assistant and a stable key, and leaves at once', async () => {
    const placed: unknown[] = [];
    const calls: AiCallPort = { place: async (r) => (placed.push(r), { ok: true, callId: 'c1' }) };
    const { out } = await runNode('ai_call', { assistantId: '9' }, { calls });
    expect(placed[0]).toEqual({
      orgId: 7,
      to: '15551234567',
      assistantId: 9,
      conversationId: 42,
      key: 'flow:run-1:4:n1',
    });
    goes(out.transition, 'n2');
  });

  it('notes a refused call and a thrown one, and still moves on', async () => {
    const refused = await runNode(
      'ai_call',
      {},
      { calls: { place: async () => ({ ok: false, error: 'no_voice_assistant' }) } },
    );
    expect(refused.out.notes.join()).toContain('no_voice_assistant');
    goes(refused.out.transition, 'n2');
    const thrown = await runNode(
      'ai_call',
      {},
      {
        calls: {
          place: async () => {
            throw new Error('bridge down');
          },
        },
      },
    );
    expect(thrown.out.notes.join()).toContain('bridge down');
    goes(thrown.out.transition, 'n2');
  });

  it('the default adapter says calls are unavailable', async () => {
    const { AiCallUnavailable } =
      await import('../../../src/infra/providers/flow-runtime-engine/ai-call.port');
    const r = await runNode('ai_call', {}, { calls: new AiCallUnavailable() });
    expect(r.out.notes.join()).toContain('calls_unavailable');
  });
});
