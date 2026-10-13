import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  applyCustomReply,
  executeCurrent,
  type StepDeps,
  type StepOutcome,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import { AskMediaNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/ask-media-nodes';
import {
  decodeInbound,
  type InboundInput,
} from '../../../src/modules/flow-runtime-engine/runtime/reply-router';
import type {
  InboundReply,
  OutboundMessage,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';
import {
  renderForChannel,
  profileOf,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';
import { interpolate } from '../../../src/modules/flow-runtime-engine/runtime/variables';

/** TW-FLB-081, 082: the Ask for file / image and Ask for location executors, driven through the real engine core. */

const builder = (type: 'ask_file' | 'ask_location', data: Record<string, unknown>) =>
  compileGraph({
    flowNodes: [
      { id: 't', type: 'trigger', isStart: true, data: {} },
      { id: 'a', type, data },
      { id: 'next', type: 'message', data: { text: 'ok' } },
    ],
    flowEdges: [
      { source: 't', target: 'a' },
      { source: 'a', sourceHandle: 'out', target: 'next' },
    ],
  });

function runOf(graph: ReturnType<typeof builder>, over: Partial<RunState> = {}): RunState {
  return {
    id: 1,
    uuid: 'run-uuid',
    orgId: 1,
    flowId: 1,
    subscriberId: null,
    contactId: 5,
    channelId: 1,
    channelUuid: 'c',
    channelKind: 'whatsapp_cloud',
    contactUuid: null,
    peerKey: '1',
    conversationId: null,
    source: 'keyword',
    triggerText: null,
    status: 'running',
    graph,
    graphVersionId: null,
    nodeCount: 0,
    currentNodeId: 'a',
    stepSeq: 3,
    vars: {},
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
    ...over,
  };
}

function harness(contacts = { setPropertyFromFlow: vi.fn(async () => true) }) {
  const sent: OutboundMessage[] = [];
  const node = new AskMediaNodes(contacts as never);
  const deps: StepDeps = {
    send: async (_r, m) => {
      sent.push(m);
      return { ok: true };
    },
    paceMs: () => 0,
    now: () => new Date(0),
    executors: [node],
  };
  return { sent, deps, contacts };
}

async function park(
  graph: ReturnType<typeof builder>,
  h = harness(),
): Promise<{ run: RunState; h: ReturnType<typeof harness>; first: StepOutcome }> {
  const run = runOf(graph);
  const first = await executeCurrent(run, h.deps);
  if (first.transition.t === 'wait') {
    run.wait = first.transition.wait;
    run.status = 'waiting';
  }
  return { run, h, first };
}

const reply = (m: InboundInput): InboundReply => decodeInbound(m)!;
const photo = (extra: Partial<InboundInput> = {}): InboundReply =>
  reply({
    kind: 'media',
    body: 'my id',
    mediaUrl: 'chatmedia:k1',
    media: { kind: 'image', mime: 'image/jpeg' },
    ...extra,
  });
const pin = reply({
  kind: 'location',
  location: { latitude: 12.9, longitude: 77.5, name: 'Cafe', address: '1 Main St' },
});

async function answer(run: RunState, h: ReturnType<typeof harness>, r: InboundReply) {
  const out = await applyCustomReply(run, r, h.deps);
  if (out.transition.t === 'wait') run.wait = out.transition.wait;
  return out;
}

describe('ask_file: the prompt and the parked wait', () => {
  it('compiles to AskFile and sends the rendered prompt as text, then parks a Custom wait', async () => {
    const g = builder('ask_file', { prompt: 'Send your ID, {{name}}', var: 'id_card' });
    expect(g.nodes.find((n) => n.id === 'a')!.type).toBe('AskFile');
    const run = runOf(g, { vars: { name: 'Sam' } });
    const h = harness();
    const out = await executeCurrent(run, h.deps);
    // The question says it waits for a file, so the website chat window shows its attach button.
    expect(h.sent).toEqual([
      { kind: 'text', body: 'Send your ID, Sam', input: { type: 'file', accept: [] } },
    ]);
    expect(out.transition).toMatchObject({
      t: 'wait',
      wait: { kind: 'Custom', handler: 'AskFile', variable: 'id_card', data: { attempts: 0 } },
    });
  });

  it('a prompt that renders empty still sends a visible message', async () => {
    const { h } = await park(builder('ask_file', { prompt: '{{nothing}}' }));
    expect(h.sent[0]).toMatchObject({ kind: 'text' });
    expect((h.sent[0] as { body: string }).body.length).toBeGreaterThan(5);
  });

  it('a timeout set on the node becomes the wait limit; none keeps the run default', async () => {
    const a = await park(builder('ask_file', { prompt: 'x', timeoutMinutes: 3 }));
    expect(a.first.transition).toMatchObject({ t: 'wait', wait: { timeoutSeconds: 180 } });
    const b = await park(builder('ask_file', { prompt: 'x', timeoutMinutes: 0 }));
    expect((b.first.transition as { wait: object }).wait).not.toHaveProperty('timeoutSeconds');
  });
});

describe('ask_file: the reply', () => {
  it('a file is saved as link, kind, name, mime and caption, and the run leaves by its one port', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', var: 'doc' }));
    const out = await answer(run, h, photo());
    expect(out.transition).toMatchObject({ t: 'goto', nodeId: 'next' });
    expect(run.vars).toMatchObject({
      doc: 'chatmedia:k1',
      doc_url: 'chatmedia:k1',
      doc_kind: 'image',
      doc_name: '',
      doc_mime: 'image/jpeg',
      doc_caption: 'my id',
      doc_status: 'received',
      a: 'chatmedia:k1',
    });
    expect(interpolate('{{doc}} / {{doc_kind}}', run.vars)).toBe('chatmedia:k1 / image');
  });

  it('a document keeps its file name', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', var: 'doc' }));
    await answer(
      run,
      h,
      reply({
        kind: 'media',
        mediaUrl: 'chatmedia:k2',
        media: { kind: 'document', mime: 'application/pdf', name: 'Invoice.PDF' },
      }),
    );
    expect(run.vars).toMatchObject({ doc_name: 'Invoice.PDF', doc_kind: 'document' });
  });

  it('only the allowed extensions pass: by file name, or by mime type when WhatsApp sends no name', async () => {
    const g = builder('ask_file', { prompt: 'x', extensions: ['pdf', 'png'], retries: 5 });
    const { run, h } = await park(g);
    // a jpeg photo: neither the name nor the mime is listed -> wrong reply, still waiting
    const refused = await answer(run, h, photo());
    expect(refused.transition.t).toBe('wait');
    expect(h.sent.at(-1)).toMatchObject({ kind: 'text' });
    // a PDF by name
    const ok = await answer(
      run,
      h,
      reply({
        kind: 'media',
        mediaUrl: 'chatmedia:k3',
        media: { kind: 'document', mime: 'application/octet-stream', name: 'a.pdf' },
      }),
    );
    expect(ok.transition.t).toBe('goto');
  });

  it('a png photo with no file name passes on its mime type', async () => {
    const g = builder('ask_file', { prompt: 'x', extensions: ['png'] });
    const { run, h } = await park(g);
    const out = await answer(
      run,
      h,
      photo({ media: { kind: 'image', mime: 'image/png' }, mediaUrl: 'chatmedia:k4' }),
    );
    expect(out.transition.t).toBe('goto');
  });

  it('no extension selected accepts any file, including audio', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', extensions: [] }));
    const out = await answer(
      run,
      h,
      reply({
        kind: 'media',
        mediaUrl: 'chatmedia:v',
        media: { kind: 'audio', mime: 'audio/ogg', name: '' },
      }),
    );
    expect(out.transition.t).toBe('goto');
  });

  it('plain text is a wrong reply: the wrong-reply text is sent and the run keeps waiting with the count kept', async () => {
    const { run, h } = await park(
      builder('ask_file', {
        prompt: 'x',
        wrongReply: 'Please attach a file, {{name}}',
        retries: 2,
      }),
    );
    run.vars.name = 'Sam';
    const out = await answer(run, h, reply({ kind: 'text', body: 'no thanks' }));
    expect(out.transition).toMatchObject({ t: 'wait', wait: { data: { attempts: 1 } } });
    expect(h.sent.at(-1)).toEqual({
      kind: 'text',
      body: 'Please attach a file, Sam',
      input: { type: 'file', accept: [] },
    });
    expect(run.wait?.data).toEqual({ attempts: 1 });
  });

  it('after the retry limit the run continues with empty values and a failed status (default)', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', var: 'doc', retries: 1 }));
    const first = await answer(run, h, reply({ kind: 'text', body: 'a' }));
    expect(first.transition.t).toBe('wait');
    const second = await answer(run, h, reply({ kind: 'text', body: 'b' }));
    expect(second.transition).toMatchObject({ t: 'goto', nodeId: 'next' });
    expect(run.vars).toMatchObject({ doc: '', doc_status: 'failed', doc_kind: '' });
  });

  it('retries 0 gives up on the first wrong reply, without a message', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', retries: 0 }));
    const sentBefore = h.sent.length;
    const out = await answer(run, h, reply({ kind: 'text', body: 'a' }));
    expect(out.transition.t).toBe('goto');
    expect(h.sent).toHaveLength(sentBefore);
  });

  it('onFail "end" ends the run when the retries are used up', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', retries: 0, onFail: 'end' }));
    const out = await answer(run, h, reply({ kind: 'text', body: 'a' }));
    expect(out.transition).toMatchObject({ t: 'end', status: 'completed' });
  });

  it('the skip word moves on with a skipped status; other text does not', async () => {
    const g = builder('ask_file', { prompt: 'x', var: 'doc', skipKeyword: 'Skip' });
    const { run, h } = await park(g);
    const out = await answer(run, h, reply({ kind: 'text', body: ' skip ' }));
    expect(out.transition.t).toBe('goto');
    expect(run.vars).toMatchObject({ doc: '', doc_status: 'skipped' });
  });

  it('a location sent to a file question is a wrong reply', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x' }));
    const out = await answer(run, h, pin);
    expect(out.transition.t).toBe('wait');
  });

  it('a tap or a reaction never answers; an outside event is ignored', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x' }));
    const ext = await applyCustomReply(run, { kind: 'external', id: '', text: '' }, h.deps);
    expect(ext.transition.t).toBe('none');
    expect(decodeInbound({ kind: 'reaction' })).toBeNull();
  });

  it('a file whose link is not stored yet is still accepted, with a note', async () => {
    const { run, h } = await park(builder('ask_file', { prompt: 'x', var: 'doc' }));
    const out = await answer(
      run,
      h,
      reply({ kind: 'media', media: { kind: 'image', mime: 'image/png' } }),
    );
    expect(out.transition.t).toBe('goto');
    expect(out.notes.join(' ')).toContain('no link yet');
  });

  it('"save the response as property" writes the link to the contact property', async () => {
    const h = harness();
    const { run } = await park(
      builder('ask_file', { prompt: 'x', saveProperty: true, propertyKey: 'id_proof' }),
      h,
    );
    await answer(run, h, photo());
    expect(h.contacts.setPropertyFromFlow).toHaveBeenCalledWith(1, 5, 'id_proof', 'chatmedia:k1');
  });

  it('without the tick nothing is written; a refused write never stops the flow', async () => {
    const h = harness();
    const a = await park(builder('ask_file', { prompt: 'x', propertyKey: 'id_proof' }), h);
    await answer(a.run, h, photo());
    expect(h.contacts.setPropertyFromFlow).not.toHaveBeenCalled();

    const failing = harness({
      setPropertyFromFlow: vi.fn(async () => Promise.reject(new Error('db'))),
    });
    const b = await park(
      builder('ask_file', { prompt: 'x', saveProperty: true, propertyKey: 'k' }),
      failing,
    );
    const out = await answer(b.run, failing, photo());
    expect(out.transition.t).toBe('goto');
    expect(out.notes.join(' ')).toContain('could not be saved');
  });

  it('the saved link is usable by a later Send media node', async () => {
    const g = compileGraph({
      flowNodes: [
        { id: 't', type: 'trigger', isStart: true, data: {} },
        { id: 'a', type: 'ask_file', data: { prompt: 'x', var: 'doc' } },
        { id: 'm', type: 'media', data: { kind: 'image', url: '{{doc}}' } },
      ],
      flowEdges: [
        { source: 't', target: 'a' },
        { source: 'a', sourceHandle: 'out', target: 'm' },
      ],
    });
    const { run, h } = await park(g);
    await answer(run, h, photo());
    run.currentNodeId = 'm';
    const sent: OutboundMessage[] = [];
    const deps: StepDeps = { ...h.deps, send: async (_r, m) => (sent.push(m), { ok: true }) };
    await executeCurrent(run, deps);
    expect(sent[0]).toMatchObject({ kind: 'media', url: 'chatmedia:k1' });
  });
});

describe('ask_location', () => {
  it('sends a WhatsApp location request on a channel that has it, plain text with a hint elsewhere', async () => {
    const g = builder('ask_location', { prompt: 'Where are you?' });
    expect(g.nodes.find((n) => n.id === 'a')!.type).toBe('AskLocation');
    const { h, first } = await park(g);
    expect(h.sent[0]).toMatchObject({ kind: 'location_request', body: 'Where are you?' });
    expect(first.transition).toMatchObject({
      t: 'wait',
      wait: { kind: 'Custom', handler: 'AskLocation', variable: 'location' },
    });
    expect(renderForChannel(h.sent[0]!, profileOf('whatsapp_cloud'))).toEqual({
      kind: 'interactive',
      interactive: { type: 'location_request', body: 'Where are you?' },
    });
    const qr = renderForChannel(h.sent[0]!, profileOf('whatsapp_qr'));
    expect(qr.kind).toBe('text');
    expect((qr as { body: string }).body).toContain('Where are you?');
    expect((qr as { body: string }).body).toContain('Location');
  });

  it('"interactive" off sends the prompt as plain text', async () => {
    const { h } = await park(builder('ask_location', { prompt: 'Where?', interactive: false }));
    expect(h.sent[0]).toEqual({ kind: 'text', body: 'Where?' });
  });

  it('a shared location is saved as latitude, longitude, name, address and a Google Maps link', async () => {
    const { run, h } = await park(builder('ask_location', { prompt: 'x', var: 'loc' }));
    const out = await answer(run, h, pin);
    expect(out.transition).toMatchObject({ t: 'goto', nodeId: 'next' });
    expect(run.vars).toMatchObject({
      loc: 'https://www.google.com/maps?q=12.9,77.5',
      loc_link: 'https://www.google.com/maps?q=12.9,77.5',
      loc_latitude: 12.9,
      loc_longitude: 77.5,
      loc_name: 'Cafe',
      loc_address: '1 Main St',
      loc_status: 'received',
    });
  });

  it('a location without a name still saves; name and address are empty', async () => {
    const { run, h } = await park(builder('ask_location', { prompt: 'x', var: 'loc' }));
    await answer(run, h, reply({ kind: 'location', location: { latitude: 1, longitude: 2 } }));
    expect(run.vars).toMatchObject({ loc_name: '', loc_address: '', loc_latitude: 1 });
  });

  it('text or a file is a wrong reply with retries, then the run continues as failed', async () => {
    const { run, h } = await park(
      builder('ask_location', {
        prompt: 'x',
        var: 'loc',
        retries: 1,
        wrongReply: 'Use the + menu',
      }),
    );
    const a = await answer(run, h, reply({ kind: 'text', body: 'Bangalore' }));
    expect(a.transition.t).toBe('wait');
    expect(h.sent.at(-1)).toEqual({ kind: 'text', body: 'Use the + menu' });
    const b = await answer(run, h, photo());
    expect(b.transition.t).toBe('goto');
    expect(run.vars).toMatchObject({ loc: '', loc_status: 'failed', loc_latitude: '' });
  });

  it('a photo sent to the location question is a wrong reply too', async () => {
    const { run, h } = await park(builder('ask_location', { prompt: 'x' }));
    const out = await answer(run, h, photo());
    expect(out.transition.t).toBe('wait');
  });

  it('the skip word works the same', async () => {
    const { run, h } = await park(
      builder('ask_location', { prompt: 'x', var: 'loc', skipKeyword: 'no' }),
    );
    const out = await answer(run, h, reply({ kind: 'text', body: 'No' }));
    expect(out.transition.t).toBe('goto');
    expect(run.vars).toMatchObject({ loc_status: 'skipped' });
  });
});

describe('inbound decoding for the two nodes', () => {
  it('a media message carries its kind, mime, name and caption', () => {
    expect(photo().data).toEqual({
      mediaKind: 'image',
      mime: 'image/jpeg',
      name: '',
      caption: 'my id',
    });
  });
  it('a media message with no media descriptor stays as before (no data)', () => {
    expect(decodeInbound({ kind: 'media', body: 'c', mediaUrl: 'u' })).not.toHaveProperty('data');
  });
});
