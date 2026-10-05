import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flbDefaultNodeData, flbNormalizeGraph } from '@crm/contracts';
import { simInbound, until } from '../chat-conversations/pipeline-support';
import {
  openChannel,
  runsOf,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * "Ask for file / image" and "Ask for location" (TW-FLB-081, 082: an addition beyond Reference) end to end: flows saved through the
 * editor's own API (`POST /v2/flows`, then publish), driven by what a customer does on the simulator channel (a text, a photo, a
 * document, a shared location), through the real engine: inbox ingest (the file is stored), reply router, run store, step queue and
 * sender. Real WhatsApp cannot run here: the simulator channel stands in for the Cloud API (its profile carries the interactive
 * "send location" request) and its media fixture stands in for the provider's download.
 */
let p: FlowPipeline;
const envelopes: Array<{
  to?: string;
  kind?: string;
  interactive?: { type?: string; body?: string };
  media?: { key?: string; mediaKind?: string };
}> = [];

beforeAll(async () => {
  p = await startFlowPipeline();
  const { ChannelDispatcher } = await import('../../../src/modules/chat-conversations');
  const dispatcher = p.h.app.get(ChannelDispatcher, { strict: false });
  const send = dispatcher.send.bind(dispatcher);
  dispatcher.send = (async (input: Parameters<typeof send>[0]) => {
    envelopes.push(input.envelope as (typeof envelopes)[number]);
    return send(input);
  }) as typeof dispatcher.send;
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9198${String(30000000 + counter++).padStart(8, '0')}`;

type EditorNode = { id: string; type: string; data?: Record<string, unknown> };

const editorGraph = (nodes: EditorNode[], edges: Array<[string, string]>) =>
  flbNormalizeGraph({
    flowNodes: [
      {
        id: 'trig',
        type: 'trigger',
        x: 0,
        y: 0,
        isStart: true,
        data: flbDefaultNodeData('trigger'),
      },
      ...nodes.map((n, i) => ({
        id: n.id,
        type: n.type,
        x: 300 * (i + 1),
        y: 0,
        data: { ...flbDefaultNodeData(n.type), ...n.data },
      })),
    ],
    flowEdges: [['trig', nodes[0]!.id] as [string, string], ...edges].map(
      ([source, target], i) => ({ id: `e${i}`, source, sourceHandle: 'out', target }),
    ),
  });

async function saveFlow(
  t: Tenant,
  name: string,
  keyword: string,
  nodes: EditorNode[],
  edges: Array<[string, string]>,
): Promise<{ uuid: string; id: number }> {
  const g = editorGraph(nodes, edges);
  const trig = g.flowNodes.find((n) => n.id === 'trig')!;
  trig.data = { ...trig.data, kind: 'keyword', keywords: keyword };
  const created = await p.api.as(t.admin).post('/v2/flows').send({ name, graph: g });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const published = await p.api.as(t.admin).post(`/v2/flows/${created.body.id}/publish`);
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  const row = await p.h.owner.query(
    `UPDATE flows SET provider = 'simulator' WHERE org_id = $1 AND uuid = $2 RETURNING id`,
    [t.orgId, created.body.id],
  );
  return { uuid: String(created.body.id), id: Number(row.rows[0].id) };
}

const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });
const sendFile = (
  t: Tenant,
  ch: SimChannel,
  peer: string,
  media: { mediaKind: string; mime: string; name?: string },
  text?: string,
) => simInbound(p as never, t, ch, { from: peer, name: 'Asha', kind: 'media', media, text });
const sendPin = (
  t: Tenant,
  ch: SimChannel,
  peer: string,
  location: { latitude: number; longitude: number; name?: string; address?: string },
) => simInbound(p as never, t, ch, { from: peer, name: 'Asha', kind: 'location', location });

async function arrangeOrg(label: string) {
  const t = await p.api.signup(label);
  const ch = await openChannel(p, t);
  return { t, ch };
}

const waitingOn = (p2: FlowPipeline, t: Tenant, flowId: number, nodeId: string) =>
  untilRun(
    p2,
    t,
    flowId,
    `waiting on ${nodeId}`,
    (r) => r.status === 'waiting' && r.wait?.nodeId === nodeId,
  );

describe('Ask for file / image', () => {
  it('sends the question, parks, takes a photo, saves its link, kind and mime, and carries on', async () => {
    const { t, ch } = await arrangeOrg('askfa');
    const f = await saveFlow(
      t,
      'kyc',
      'kyc',
      [
        { id: 'a', type: 'ask_file', data: { prompt: 'Send your ID, {{name}}', var: 'doc' } },
        {
          id: 'm',
          type: 'message',
          data: { text: 'Got {{doc_kind}} ({{doc_mime}}) - {{doc_status}}' },
        },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'kyc');
    await waitingOn(p, t, f.id, 'a');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Send your ID, Asha']);

    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/jpeg' }, 'front side');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(String(run.vars.doc)).toMatch(/^chatmedia:/);
    expect(run.vars).toMatchObject({
      doc_kind: 'image',
      doc_mime: 'image/jpeg',
      doc_caption: 'front side',
      doc_status: 'received',
    });
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Send your ID, Asha',
      'Got image (image/jpeg) - received',
    ]);
  });

  it("plain text is a wrong reply: the author's message goes out and the run keeps waiting; the file after it is taken", async () => {
    const { t, ch } = await arrangeOrg('askfb');
    const f = await saveFlow(
      t,
      'kyc2',
      'kyc2',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: {
            prompt: 'Photo please',
            var: 'doc',
            retries: 2,
            wrongReply: 'Attach a photo, not text',
          },
        },
        { id: 'm', type: 'message', data: { text: 'thanks {{doc_status}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'kyc2');
    await waitingOn(p, t, f.id, 'a');
    await say(t, ch, peer, 'I have no photo');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Photo please',
      'Attach a photo, not text',
    ]);
    const still = await waitingOn(p, t, f.id, 'a');
    expect(still.status).toBe('waiting');
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/png' });
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'Photo please',
      'Attach a photo, not text',
      'thanks received',
    ]);
  });

  it('only the allowed extensions pass: a pdf is refused when only png is allowed, a png is taken (by mime and by name)', async () => {
    const { t, ch } = await arrangeOrg('askfc');
    const f = await saveFlow(
      t,
      'png only',
      'pngonly',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: {
            prompt: 'PNG please',
            var: 'img',
            extensions: ['png'],
            retries: 3,
            wrongReply: 'PNG only',
          },
        },
        { id: 'm', type: 'message', data: { text: 'ok {{img_name}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'pngonly');
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'document', mime: 'application/pdf', name: 'a.pdf' });
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['PNG please', 'PNG only']);
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/jpeg' });
    expect(await untilSent(p, t, ch, peer, 3)).toEqual(['PNG please', 'PNG only', 'PNG only']);
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/png', name: 'id.PNG' });
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars.img_name).toBe('id.PNG');
    expect(await untilSent(p, t, ch, peer, 4)).toEqual([
      'PNG please',
      'PNG only',
      'PNG only',
      'ok id.PNG',
    ]);
  });

  it('with no extension selected any file is accepted, a voice note included', async () => {
    const { t, ch } = await arrangeOrg('askfd');
    const f = await saveFlow(
      t,
      'any',
      'anyfile',
      [
        { id: 'a', type: 'ask_file', data: { prompt: 'Anything', var: 'f' } },
        { id: 'm', type: 'message', data: { text: '{{f_kind}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'anyfile');
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'audio', mime: 'audio/ogg' });
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect((await untilSent(p, t, ch, peer, 2))[1]).toBe('audio');
  });

  it('retries used up: the run moves on with an empty answer and a failed status (default), or ends when the author said so', async () => {
    const { t, ch } = await arrangeOrg('askfe');
    const cont = await saveFlow(
      t,
      'give up',
      'giveup',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: { prompt: 'File?', var: 'f', retries: 1, wrongReply: 'file!' },
        },
        { id: 'm', type: 'message', data: { text: 'status={{f_status}} value=[{{f}}]' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'giveup');
    await waitingOn(p, t, cont.id, 'a');
    await say(t, ch, peer, 'no');
    await untilSent(p, t, ch, peer, 2);
    await say(t, ch, peer, 'still no');
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'File?',
      'file!',
      'status=failed value=[]',
    ]);

    const end = await saveFlow(
      t,
      'give up end',
      'enditnow',
      [
        { id: 'a', type: 'ask_file', data: { prompt: 'File2?', retries: 0, onFail: 'end' } },
        { id: 'm', type: 'message', data: { text: 'never sent' } },
      ],
      [['a', 'm']],
    );
    const peer2 = nextPeer();
    await say(t, ch, peer2, 'enditnow');
    await waitingOn(p, t, end.id, 'a');
    await say(t, ch, peer2, 'nope');
    const run = await untilRun(p, t, end.id, 'ended', (r) => r.status === 'completed');
    expect(run.end_reason).toBe('end_node');
    expect(await untilSent(p, t, ch, peer2, 1)).toEqual(['File2?']);
  });

  it('the skip word moves on with a skipped status', async () => {
    const { t, ch } = await arrangeOrg('askff');
    const f = await saveFlow(
      t,
      'skippable',
      'skippable',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: { prompt: 'Optional file', var: 'f', skipKeyword: 'skip' },
        },
        { id: 'm', type: 'message', data: { text: '{{f_status}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'skippable');
    await waitingOn(p, t, f.id, 'a');
    await say(t, ch, peer, ' SKIP ');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['Optional file', 'skipped']);
  });

  it('the saved link is a stored file a later Send media node can send back', async () => {
    const { t, ch } = await arrangeOrg('askfg');
    const f = await saveFlow(
      t,
      'echo',
      'echo',
      [
        { id: 'a', type: 'ask_file', data: { prompt: 'Send a picture', var: 'pic' } },
        {
          id: 'x',
          type: 'media',
          data: { kind: 'image', url: '{{pic}}', caption: 'You sent this' },
        },
      ],
      [['a', 'x']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'echo');
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/png', name: 'me.png' });
    const out = await until('the media envelope', async () =>
      envelopes.find((e) => e.to === peer && e.kind === 'media'),
    );
    expect(out.media?.key).toBeTruthy();
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(String(run.vars.pic)).toBe(`chatmedia:${out.media!.key}`);
  });

  it('"save the response as property" writes the link to the contact property; an unknown property key is only noted', async () => {
    const { t, ch } = await arrangeOrg('askfh');
    const attr = await p.api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'ID proof', key: 'id_proof', type: 'text' });
    expect(attr.status, JSON.stringify(attr.body)).toBe(201);
    const f = await saveFlow(
      t,
      'property',
      'property',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: { prompt: 'ID?', var: 'doc', saveProperty: true, propertyKey: 'id_proof' },
        },
        { id: 'm', type: 'message', data: { text: 'saved' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'property');
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/jpeg' });
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    const row = await until('the contact property', async () => {
      const r = await p.h.owner.query(
        `SELECT c.data FROM contacts c JOIN conversations v ON v.org_id = c.org_id AND v.contact_id = c.id
         WHERE c.org_id = $1 AND v.peer_key = $2 AND c.data ? 'id_proof'`,
        [t.orgId, peer],
      );
      return r.rows[0] as { data: Record<string, unknown> } | undefined;
    });
    expect(row.data.id_proof).toBe(run.vars.doc);

    const bad = await saveFlow(
      t,
      'property bad',
      'badprop',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: {
            prompt: 'ID again?',
            var: 'doc',
            saveProperty: true,
            propertyKey: 'not_a_property',
          },
        },
        { id: 'm', type: 'message', data: { text: 'done anyway' } },
      ],
      [['a', 'm']],
    );
    const peer2 = nextPeer();
    await say(t, ch, peer2, 'badprop');
    await waitingOn(p, t, bad.id, 'a');
    await sendFile(t, ch, peer2, { mediaKind: 'image', mime: 'image/jpeg' });
    await untilRun(p, t, bad.id, 'completed', (r) => r.status === 'completed');
    expect(await untilSent(p, t, ch, peer2, 2)).toEqual(['ID again?', 'done anyway']);
  });

  it("a wait limit set on the node is the wait's own limit", async () => {
    const { t, ch } = await arrangeOrg('askfi');
    const f = await saveFlow(
      t,
      'limit',
      'limit',
      [{ id: 'a', type: 'ask_file', data: { prompt: 'File', timeoutMinutes: 3 } }],
      [],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'limit');
    const waiting = await waitingOn(p, t, f.id, 'a');
    const r = await p.h.owner.query(
      `SELECT extract(epoch FROM (expires_at - now())) AS left FROM flow_runs WHERE id = $1`,
      [waiting.id],
    );
    expect(Number(r.rows[0].left)).toBeGreaterThan(120);
    expect(Number(r.rows[0].left)).toBeLessThanOrEqual(180);
  });
});

describe('Ask for location', () => {
  it('sends WhatsApp\'s "send location" request, takes the shared place and saves latitude, longitude, name, address and a maps link', async () => {
    const { t, ch } = await arrangeOrg('askla');
    const f = await saveFlow(
      t,
      'where',
      'where',
      [
        {
          id: 'a',
          type: 'ask_location',
          data: { prompt: 'Where should we deliver?', var: 'place' },
        },
        {
          id: 'm',
          type: 'message',
          data: {
            text: '{{place_name}} / {{place_address}} / {{place_latitude}},{{place_longitude}} / {{place}}',
          },
        },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'where');
    await waitingOn(p, t, f.id, 'a');
    const req = await until('the location request', async () =>
      envelopes.find((e) => e.to === peer && e.kind === 'interactive'),
    );
    expect(req.interactive).toMatchObject({
      type: 'location_request',
      body: 'Where should we deliver?',
    });

    await sendPin(t, ch, peer, {
      latitude: 12.9716,
      longitude: 77.5946,
      name: 'Cafe Coffee',
      address: '1 MG Road',
    });
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars).toMatchObject({
      place: 'https://www.google.com/maps?q=12.9716,77.5946',
      place_link: 'https://www.google.com/maps?q=12.9716,77.5946',
      place_latitude: 12.9716,
      place_longitude: 77.5946,
      place_name: 'Cafe Coffee',
      place_address: '1 MG Road',
      place_status: 'received',
    });
    expect((await untilSent(p, t, ch, peer, 2))[1]).toBe(
      'Cafe Coffee / 1 MG Road / 12.9716,77.5946 / https://www.google.com/maps?q=12.9716,77.5946',
    );
  });

  it('a typed address or a photo is a wrong reply; after the retries the run moves on as failed', async () => {
    const { t, ch } = await arrangeOrg('asklb');
    const f = await saveFlow(
      t,
      'where2',
      'where2',
      [
        {
          id: 'a',
          type: 'ask_location',
          data: {
            prompt: 'Share location',
            var: 'place',
            retries: 1,
            wrongReply: 'Use the + menu',
          },
        },
        { id: 'm', type: 'message', data: { text: '{{place_status}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'where2');
    await waitingOn(p, t, f.id, 'a');
    await say(t, ch, peer, '12 Park Street, Kolkata');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Share location\n[Send location]',
      'Use the + menu',
    ]);
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/jpeg' });
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'Share location\n[Send location]',
      'Use the + menu',
      'failed',
    ]);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
  });

  it('with the request button off the prompt is plain text', async () => {
    const { t, ch } = await arrangeOrg('asklc');
    const f = await saveFlow(
      t,
      'plain',
      'plainloc',
      [{ id: 'a', type: 'ask_location', data: { prompt: 'Drop a pin', interactive: false } }],
      [],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'plainloc');
    await waitingOn(p, t, f.id, 'a');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Drop a pin']);
    expect(envelopes.find((e) => e.to === peer && e.kind === 'interactive')).toBeUndefined();
  });

  it('a flow with both nodes, one after the other, carries both answers to the end', async () => {
    const { t, ch } = await arrangeOrg('askld');
    const f = await saveFlow(
      t,
      'both',
      'both',
      [
        {
          id: 'a',
          type: 'ask_file',
          data: { prompt: 'ID photo', var: 'doc', extensions: ['jpg', 'jpeg', 'png'] },
        },
        { id: 'b', type: 'ask_location', data: { prompt: 'Your location', var: 'place' } },
        { id: 'm', type: 'message', data: { text: 'ID {{doc_kind}}, at {{place_name}}' } },
      ],
      [
        ['a', 'b'],
        ['b', 'm'],
      ],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'both');
    await waitingOn(p, t, f.id, 'a');
    await sendFile(t, ch, peer, { mediaKind: 'image', mime: 'image/jpeg' });
    await waitingOn(p, t, f.id, 'b');
    await sendPin(t, ch, peer, { latitude: 1, longitude: 2, name: 'Home' });
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'ID photo',
      'Your location\n[Send location]',
      'ID image, at Home',
    ]);
    expect((await runsOf(p, t, f.id)).length).toBe(1);
  });
});
