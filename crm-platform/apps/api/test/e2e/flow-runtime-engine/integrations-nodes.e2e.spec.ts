import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  openChannel,
  startFlowPipeline,
  sweeper,
  system,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * The integration nodes (TW-FLR-032 to 034, 044 to 048) through the real engine: run store, step queue, sender, sweeper and the
 * Google Form submission door. Providers that are not reachable from a test (Google, a MySQL server, the calling domain) are the
 * port instances the module built, observed with spies; the Webhook node talks to a real local HTTP server.
 */
let p: FlowPipeline;
let server: Server;
let base = '';
const hits: Array<{ url?: string; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ greeting: 'hola', user: { tier: 'gold' } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
  await new Promise<void>((r) => server.close(() => r()));
});

let counter = 0;
const nextPeer = () => `9197${String(10000000 + counter++).padStart(8, '0')}`;
const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });

const nodesOf = async () =>
  (
    await import('../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/integrations-nodes')
  ).IntegrationNodes;
const exec = async () => p.h.app.get(await nodesOf(), { strict: false });
const port = async <T>(token: symbol): Promise<T> => p.h.app.get<T>(token, { strict: false });

interface Arranged {
  t: Tenant;
  ch: SimChannel;
  flowId: number;
}

async function arrange(
  label: string,
  nodes: unknown[],
  edges: unknown[],
  keyword: string,
): Promise<Arranged> {
  const t = await p.api.signup(label);
  const ch = await openChannel(p, t);
  const f = await addFlow(p, t, {
    graph: graph(
      [node('t', 'trigger', {}, { isStart: true }), ...nodes],
      [edge('t', (nodes[0] as { id: string }).id), ...edges],
    ),
    trigger: { kind: 'keyword', keywords: keyword },
  });
  return { t, ch, flowId: f.id };
}

describe('Webhook node', () => {
  it('calls a public host, saves the response and uses it in the next message', async () => {
    const e = (await exec()) as unknown as { safeFetch: { isBlocked: (a: string) => boolean } };
    const original = e.safeFetch.isBlocked;
    e.safeFetch.isBlocked = () => false; // the test server is on loopback
    try {
      const a = await arrange(
        'flrwh',
        [
          node('w', 'webhook', {
            url: `${base}/hook?who={{name}}`,
            body: '{"n":"{{name}}"}',
            variable: 'api',
          }),
          node('m', 'message', { text: '{{api.greeting}} {{api.user.tier}} {{name}}' }),
        ],
        [edge('w', 'm')],
        'whgo',
      );
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'whgo');
      expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['hola gold Asha']);
      const hit = hits.find((h) => h.url?.startsWith('/hook'));
      expect(hit?.url).toBe('/hook?who=Asha');
      expect(JSON.parse(hit!.body)).toMatchObject({ n: 'Asha' });
      const run = await untilRun(p, a.t, a.flowId, 'completed', (r) => r.status === 'completed');
      expect(run.vars['api.greeting']).toBe('hola');
    } finally {
      e.safeFetch.isBlocked = original;
    }
  });

  it('refuses an internal host (SSRF) and the flow carries on with an empty variable', async () => {
    const a = await arrange(
      'flrssrf',
      [
        node('w', 'webhook', { url: 'http://169.254.169.254/latest/meta-data', variable: 'api' }),
        node('m', 'message', { text: 'after [{{api}}]' }),
      ],
      [edge('w', 'm')],
      'ssrfgo',
    );
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'ssrfgo');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['after []']);
  });
});

describe('Code node', () => {
  it('computes in the sandbox and the next message reads the result', async () => {
    const a = await arrange(
      'flrcode',
      [
        node('c', 'code', {
          code: 'return { greeting: "hi " + allResponses.name.toUpperCase() };',
          variable: 'out',
        }),
        node('m', 'message', { text: '{{out.greeting}}' }),
      ],
      [edge('c', 'm')],
      'codego',
    );
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'codego');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['hi ASHA']);
  });
});

describe('MySQL and AI call nodes', () => {
  it('runs the query through the port and maps the rows', async () => {
    const { MYSQL_QUERY } =
      await import('../../../src/infra/providers/flow-runtime-engine/mysql-query.port');
    const mysql = await port<{ query: (r: unknown) => Promise<unknown[]> }>(MYSQL_QUERY);
    const spy = vi.spyOn(mysql, 'query').mockResolvedValue([{ name: 'Widget', qty: 3 }]);
    const e = (await exec()) as unknown as { safeFetch: { isBlocked: (a: string) => boolean } };
    const original = e.safeFetch.isBlocked;
    e.safeFetch.isBlocked = () => false;
    try {
      const a = await arrange(
        'flrmysql',
        [
          node('q', 'mysql', {
            host: '203.0.113.9',
            database: 'shop',
            username: 'ro',
            password: 'x',
            sql: "SELECT name, qty FROM items WHERE sku = '{{sku}}'",
          }),
          node('m', 'message', { text: '{{rows.0.name}} x{{rows.0.qty}} ({{rows.length}} row)' }),
        ],
        [edge('q', 'm')],
        'sqlgo',
      );
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'sqlgo');
      expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['Widget x3 (1 row)']);
      expect(spy.mock.calls[0]![0]).toMatchObject({
        host: '203.0.113.9',
        address: '203.0.113.9',
        database: 'shop',
        maxRows: 100,
      });
    } finally {
      e.safeFetch.isBlocked = original;
      spy.mockRestore();
    }
  });

  it('a MySQL host on the internal network is refused before any connection', async () => {
    const { MYSQL_QUERY } =
      await import('../../../src/infra/providers/flow-runtime-engine/mysql-query.port');
    const mysql = await port<{ query: (r: unknown) => Promise<unknown[]> }>(MYSQL_QUERY);
    const spy = vi.spyOn(mysql, 'query');
    const a = await arrange(
      'flrmysqlint',
      [
        node('q', 'mysql', { host: '10.1.2.3', database: 'd', sql: 'SELECT 1' }),
        node('m', 'message', { text: 'rows=[{{rows}}]' }),
      ],
      [edge('q', 'm')],
      'sqlint',
    );
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'sqlint');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['rows=[]']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('places the AI call for this workspace and the flow moves on', async () => {
    const { AI_CALL } =
      await import('../../../src/infra/providers/flow-runtime-engine/ai-call.port');
    const calls = await port<{ place: (r: unknown) => Promise<unknown> }>(AI_CALL);
    const spy = vi.spyOn(calls, 'place').mockResolvedValue({ ok: true, callId: 'call-1' });
    const a = await arrange(
      'flrcall',
      [node('c', 'ai_call', { assistantId: 5 }), node('m', 'message', { text: 'calling you' })],
      [edge('c', 'm')],
      'callgo',
    );
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'callgo');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['calling you']);
    expect(spy.mock.calls[0]![0]).toMatchObject({ orgId: a.t.orgId, to: peer, assistantId: 5 });
    expect(String((spy.mock.calls[0]![0] as { key: string }).key)).toMatch(/^flow:/);
    spy.mockRestore();
  });
});

describe('Google nodes', () => {
  it('without a connected Google account the nodes report it and the flow continues', async () => {
    const a = await arrange(
      'flrnog',
      [
        node('s', 'google_sheets', { sheetId: 'S1', columns: ['{{name}}'] }),
        node('d', 'google_docs', { templateId: 'T1' }),
        node('m', 'message', { text: 'done' }),
      ],
      [edge('s', 'd'), edge('d', 'm')],
      'nogo',
    );
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'nogo');
    expect(await untilSent(p, a.t, a.ch, peer, 2)).toEqual([
      "Sorry, couldn't generate your document right now. Please try again later.",
      'done',
    ]);
    const run = await untilRun(p, a.t, a.flowId, 'completed', (r) => r.status === 'completed');
    const log = await p.h.owner.query(
      `SELECT detail::text AS d FROM flow_run_steps WHERE run_id = $1`,
      [run.id],
    );
    expect(log.rows.map((r) => r.d).join('\n')).toContain('No Google account connected');
  });

  it('Sheets, Docs and Meet use the workspace and the variables of the run', async () => {
    const { GOOGLE_WORKSPACE } =
      await import('../../../src/infra/providers/flow-runtime-engine/google-workspace.port');
    const g = await port<Record<string, (...a: unknown[]) => Promise<unknown>>>(GOOGLE_WORKSPACE);
    const append = vi
      .spyOn(g as never, 'appendSheetRow' as never)
      .mockResolvedValue(undefined as never);
    const doc = vi
      .spyOn(g as never, 'generateDoc' as never)
      .mockResolvedValue({ url: 'https://docs.example/d/1' } as never);
    const meet = vi
      .spyOn(g as never, 'createMeet' as never)
      .mockResolvedValue({ meetUrl: 'https://meet.example/x', eventId: 'e1' } as never);
    try {
      const a = await arrange(
        'flrg',
        [
          node('s', 'google_sheets', {
            sheetId: 'S1',
            tabName: 'Leads',
            columns: ['{{name}}', '{{trigger_text}}'],
          }),
          node('d', 'google_docs', { templateId: 'T1', newTitle: 'For {{name}}' }),
          node('v', 'google_meet', { title: 'Chat with {{name}}' }),
        ],
        [edge('s', 'd'), edge('d', 'v')],
        'ggo',
      );
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'ggo');
      expect(await untilSent(p, a.t, a.ch, peer, 2)).toEqual([
        "Here's your document: https://docs.example/d/1",
        expect.stringContaining('https://meet.example/x'),
      ]);
      expect(append.mock.calls[0]).toMatchObject([
        a.t.orgId,
        { sheetId: 'S1', tabName: 'Leads', values: ['Asha', ''] },
      ]);
      expect(doc.mock.calls[0]![1]).toMatchObject({ templateId: 'T1', newTitle: 'For Asha' });
      expect(meet.mock.calls[0]![1]).toMatchObject({ title: 'Chat with Asha' });
    } finally {
      append.mockRestore();
      doc.mockRestore();
      meet.mockRestore();
    }
  });

  describe('Google Form', () => {
    const arrangeForm = async (label: string, keyword: string) => {
      const { GOOGLE_WORKSPACE } =
        await import('../../../src/infra/providers/flow-runtime-engine/google-workspace.port');
      const g = await port<Record<string, unknown>>(GOOGLE_WORKSPACE);
      vi.spyOn(g as never, 'formResponderUrl' as never).mockResolvedValue({
        url: 'https://forms.example/F1',
      } as never);
      return arrange(
        label,
        [
          node('f', 'google_form', { formId: 'F1', bodyText: 'Fill this', saveAs: 'survey' }),
          node('ok', 'message', { text: 'Thanks {{survey.Name}} ({{survey.Toppings}})' }),
          node('late', 'message', { text: 'Too slow' }),
        ],
        [edge('f', 'ok', 'submitted'), edge('f', 'late', 'timeout')],
        keyword,
      );
    };
    const tokenOf = async (orgId: number) => {
      const { GoogleFormWebhookService } =
        await import('../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/google-form-webhook.service');
      return p.h.app.get(GoogleFormWebhookService, { strict: false }).tokenFor(orgId);
    };
    const submit = (token: string | undefined, body: Record<string, unknown>) => {
      const r = request(p.h.app.getHttpServer()).post('/google/form-response');
      return (token ? r.set('X-Workspace-Token', token) : r).send(body);
    };

    it('parks the run, and the form submission resumes it by the submitted port with the answers', async () => {
      const a = await arrangeForm('flrform', 'formgo');
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'formgo');
      expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual([
        'Fill this\n\nhttps://forms.example/F1',
      ]);
      const waiting = await untilRun(p, a.t, a.flowId, 'waiting', (r) => r.status === 'waiting');
      expect(waiting.wait).toMatchObject({ nodeId: 'f' });

      const res = await submit(await tokenOf(a.t.orgId), {
        form_id: 'F1',
        answers: { Name: 'Ana', Toppings: ['olives', 'feta'] },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, matched: true });
      expect(await untilSent(p, a.t, a.ch, peer, 2)).toEqual([
        'Fill this\n\nhttps://forms.example/F1',
        'Thanks Ana (olives, feta)',
      ]);
      await untilRun(p, a.t, a.flowId, 'completed', (r) => r.status === 'completed');

      // The wait is answered: a second submission matches nothing.
      const again = await submit(await tokenOf(a.t.orgId), {
        form_id: 'F1',
        answers: { Name: 'Bo' },
      });
      expect(again.body).toMatchObject({ ok: true, matched: false });
    });

    it('rejects a missing or forged token, and another workspace cannot answer this one', async () => {
      const a = await arrangeForm('flrformsec', 'formsec');
      const other = await p.api.signup('flrformother');
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'formsec');
      await untilRun(p, a.t, a.flowId, 'waiting', (r) => r.status === 'waiting');
      expect((await submit(undefined, { form_id: 'F1', answers: {} })).status).toBe(401);
      expect(
        (await submit(`${a.t.orgId}.${'0'.repeat(64)}`, { form_id: 'F1', answers: {} })).status,
      ).toBe(401);
      const foreign = await submit(await tokenOf(other.orgId), {
        form_id: 'F1',
        answers: { Name: 'Eve' },
      });
      expect(foreign.body).toMatchObject({ matched: false });
      const run = (await untilRun(
        p,
        a.t,
        a.flowId,
        'still waiting',
        (r) => r.status === 'waiting',
      ))!;
      expect(run.status).toBe('waiting');
    });

    it('leaves by the timeout port when nobody submits in time', async () => {
      const a = await arrangeForm('flrformto', 'formto');
      const peer = nextPeer();
      await say(a.t, a.ch, peer, 'formto');
      const waiting = await untilRun(p, a.t, a.flowId, 'waiting', (r) => r.status === 'waiting');
      await p.h.owner.query(
        `UPDATE flow_runs SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [waiting.id],
      );
      const sw = await sweeper(p);
      await system(a.t.orgId, () => sw.tickOnce());
      expect(await untilSent(p, a.t, a.ch, peer, 2)).toEqual([
        'Fill this\n\nhttps://forms.example/F1',
        'Too slow',
      ]);
    });
  });
});
