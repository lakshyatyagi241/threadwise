import { beforeAll, describe, expect, it } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  assignConfig,
  dealConfig,
  instagramMessage,
  notifyPlan,
  tagConfig,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/actions-config';
import type {
  LastOut,
  NodeContext,
  OutboundMessage,
  SendOutcome,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

const render =
  (vars: Record<string, string> = {}) =>
  (t: unknown) =>
    String(t ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '');
const text = (body: string): LastOut => ({
  kind: 'text',
  text: body,
  url: '',
  caption: '',
  filename: null,
});

describe('tag node config (WD-FLR-035)', () => {
  it('defaults to add and reads id and name', () => {
    expect(tagConfig({ tag: ' VIP ' })).toEqual({ action: 'add', tagId: '', name: 'VIP' });
    expect(tagConfig({ action: 'REMOVE', tagId: 'abc' })).toMatchObject({
      action: 'remove',
      tagId: 'abc',
    });
    expect(tagConfig({ action: 'purge' }).action).toBe('add');
  });
});

describe('assign node config (WD-FLR-036)', () => {
  it('reads the editor keys and renders the note', () => {
    expect(
      assignConfig(
        { team: 't1', userId: 'u1', message: 'From {{name}}' },
        render({ name: 'Asha' }),
      ),
    ).toEqual({ teamId: 't1', userId: 'u1', note: 'From Asha' });
    expect(assignConfig({}, render())).toEqual({ teamId: '', userId: '', note: '' });
  });
});

describe('deal node config (WD-FLR-037)', () => {
  const vars = { name: 'Asha' };
  it('names the deal after the contact by default and keeps digits of the value', () => {
    const c = dealConfig(
      { stageId: 's', value: 'USD {{amt}}.50x' },
      render({ ...vars, amt: '12' }),
      vars,
    );
    expect(c).toMatchObject({
      action: 'create',
      stageId: 's',
      title: 'Asha — deal',
      value: '12.5',
      saveAs: 'deal_id',
    });
  });
  it('an unreadable value is 0 and a long title is cut at 191', () => {
    const c = dealConfig(
      { action: 'move', dealName: 'x'.repeat(300), value: 'n/a', saveAs: '{{my_deal}}' },
      render(),
      {},
    );
    expect(c.action).toBe('move');
    expect(c.value).toBe('0');
    expect(c.title).toHaveLength(191);
    expect(c.saveAs).toBe('my_deal');
  });
});

describe('copy to number plan (WD-FLR-038)', () => {
  it('mirrors the last message to the digits of the number', () => {
    expect(
      notifyPlan({ copyNumber: '+91 98-{{x}}' }, text('Your code is 42'), render({ x: '76' })),
    ).toEqual({
      send: true,
      to: '919876',
      message: { kind: 'text', body: 'Your code is 42' },
    });
  });
  it('skips (and the flow moves on) with no number, nothing to copy, or an empty text', () => {
    expect(notifyPlan({ copyNumber: 'abc' }, text('x'), render())).toMatchObject({ send: false });
    expect(notifyPlan({ copyNumber: '1' }, null, render())).toMatchObject({ send: false });
    expect(
      notifyPlan({ copyNumber: '1', source: 'custom', text: ' ' }, null, render()),
    ).toMatchObject({
      send: false,
    });
  });
  it('custom media needs a link; audio carries no caption', () => {
    expect(
      notifyPlan({ copyNumber: '1', source: 'custom', kind: 'pdf' }, null, render()),
    ).toMatchObject({
      send: false,
    });
    const plan = notifyPlan(
      { copyNumber: '1', source: 'custom', kind: 'audio', url: 'https://x/a.mp3', caption: 'hi' },
      null,
      render(),
    );
    expect(plan).toEqual({
      send: true,
      to: '1',
      message: { kind: 'media', mediaKind: 'audio', url: 'https://x/a.mp3' },
    });
    const doc = notifyPlan(
      {
        copyNumber: '1',
        source: 'custom',
        kind: 'report',
        url: 'https://x/r',
        caption: 'c',
        filename: 'r.pdf',
      },
      null,
      render(),
    );
    expect(doc).toMatchObject({
      message: { mediaKind: 'document', caption: 'c', filename: 'r.pdf' },
    });
  });
  it('mirrors a media message with its caption and file name', () => {
    const last: LastOut = {
      kind: 'image',
      text: '',
      url: 'https://x/i.png',
      caption: 'Look',
      filename: null,
    };
    expect(notifyPlan({ copyNumber: '5' }, last, render())).toEqual({
      send: true,
      to: '5',
      message: { kind: 'media', mediaKind: 'image', url: 'https://x/i.png', caption: 'Look' },
    });
  });
});

describe('WhatsApp to Instagram link (WD-FLR-039)', () => {
  it('builds intro plus the ig.me link, dropping the @', () => {
    expect(
      instagramMessage(
        { igUsername: '@acme.shop', introText: 'Chat on {{p}}' },
        render({ p: 'IG' }),
      ),
    ).toBe('Chat on IG\nhttps://ig.me/m/acme.shop');
  });
  it('uses the default intro when none is set, only the link when it is blank, nothing without a user', () => {
    expect(instagramMessage({ igUsername: 'acme' }, render())).toBe(
      'Continue with us on Instagram\nhttps://ig.me/m/acme',
    );
    expect(instagramMessage({ igUsername: 'acme', introText: '' }, render())).toBe(
      'https://ig.me/m/acme',
    );
    expect(instagramMessage({ igUsername: ' @ ' }, render())).toBeNull();
  });
  it('cannot be turned into another URL by the username', () => {
    expect(instagramMessage({ igUsername: 'a/b?c', introText: '' }, render())).toBe(
      'https://ig.me/m/a%2Fb%3Fc',
    );
  });
});

describe('graph compile for the action nodes', () => {
  it('maps the editor types and the deal ports', () => {
    const g = compileGraph({
      flowNodes: [
        { id: 'd', type: 'deal', data: { stageId: 's' } },
        { id: 'a', type: 'tag', data: { tag: 'x' } },
        { id: 'b', type: 'assign', data: {} },
        { id: 'c', type: 'notify_number', data: {} },
        { id: 'e', type: 'wa_to_instagram', data: {} },
        { id: 'ok', type: 'end' },
        { id: 'bad', type: 'end' },
      ],
      flowEdges: [
        { source: 'd', sourceHandle: 'created', target: 'ok' },
        { source: 'd', sourceHandle: 'error', target: 'bad' },
      ],
    });
    expect(g.nodes.map((n) => n.type)).toEqual([
      'Deal',
      'TagContact',
      'AssignAgent',
      'NotifyNumber',
      'WaToInstagram',
      'End',
      'End',
    ]);
    expect(g.edges).toEqual([
      { from: 'd_1', to: 'ok' },
      { from: 'd_2', to: 'bad' },
    ]);
    expect(g.nodes[0]!.props).toMatchObject({ data: { stageId: 's' } });
  });
});

describe('the executor', () => {
  // The services are faked; what is under test is the node's decisions and its failure paths.
  const fakes = () => {
    const calls: Record<string, unknown[]> = {};
    const rec = (k: string, v: unknown) => (calls[k] ??= []).push(v);
    const fail = { tag: false, assign: false, deal: false };
    const deps = {
      db: { txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => fn({}) },
      tags: {
        applyFromFlow: async (...a: unknown[]) => {
          rec('tag', a);
          if (fail.tag) throw new Error('tag limit');
          return { tagUuid: 't', tagName: 'VIP', changed: false };
        },
      },
      deals: {
        flowAction: async (a: unknown) => {
          rec('deal', a);
          if (fail.deal) throw new Error('plan');
          return { dealId: 'deal-1', status: 'open', created: true };
        },
      },
      assignment: {
        assignFromFlow: async (...a: unknown[]) => {
          rec('assign', a);
          if (fail.assign) throw new Error('That member is not part of this workspace.');
          return { changed: true };
        },
      },
      numbers: {
        send: async (...a: unknown[]): Promise<SendOutcome> => {
          rec('number', a);
          return { ok: true };
        },
      },
      conversationsRepo: {},
      events: {},
      conversations: { findThread: async () => ({ id: 'conv-1' }) },
    };
    return { calls, fail, deps };
  };

  const ctxOf = (
    type: string,
    data: Record<string, unknown>,
    over: Partial<NodeContext['run']> = {},
  ) => {
    const notes: string[] = [];
    const sent: OutboundMessage[] = [];
    const ctx = {
      run: {
        orgId: 7,
        contactId: 3,
        contactUuid: 'c-uuid',
        channelUuid: 'ch',
        peerKey: '911',
        vars: { name: 'Asha' },
        lastOut: text('Hello'),
        ...over,
      },
      stepKey: 'flow:r:1:n',
      node: { id: 'n', type, props: { data } },
      send: async (m: OutboundMessage): Promise<SendOutcome> => {
        sent.push(m);
        return { ok: true };
      },
      render: render({ name: 'Asha' }),
      note: (t: string) => notes.push(t),
      now: () => new Date(),
    } as unknown as NodeContext;
    return { ctx, notes, sent };
  };

  // The first import pulls the CRM, inbox and chat barrels: slow once, instant after.
  beforeAll(async () => {
    await import('../../../src/modules/flow-runtime-engine/runtime/nodes/actions/actions-nodes');
  }, 120_000);

  const build = async () => {
    const { ActionNodes } =
      await import('../../../src/modules/flow-runtime-engine/runtime/nodes/actions/actions-nodes');
    const f = fakes();
    const d = f.deps;
    return {
      ...f,
      node: new ActionNodes(
        d.db as never,
        d.tags as never,
        d.deals as never,
        d.assignment as never,
        d.numbers as never,
        d.conversationsRepo as never,
        d.events as never,
        d.conversations as never,
      ),
    };
  };

  it('Tag: a service failure is a note and the flow moves on', async () => {
    const { node, fail, calls } = await build();
    fail.tag = true;
    const { ctx, notes } = ctxOf('TagContact', { tag: 'VIP' });
    expect(await node.execute(ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(notes.join(' ')).toContain('tag step failed: tag limit');
    expect(calls.tag).toHaveLength(1);
  });

  it('Tag: no tag or no contact is skipped without calling the service', async () => {
    const { node, calls } = await build();
    expect(await node.execute(ctxOf('TagContact', {}).ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(await node.execute(ctxOf('TagContact', { tag: 'x' }, { contactId: null }).ctx)).toEqual({
      kind: 'advance',
      port: 1,
    });
    expect(calls.tag).toBeUndefined();
  });

  it('Assign: an unknown member (a non-uuid, or the service refusing) is a note, never a stop', async () => {
    const { node, fail, calls } = await build();
    const bad = ctxOf('AssignAgent', { userId: '42' });
    expect(await node.execute(bad.ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(bad.notes[0]).toContain('not part of this workspace');
    expect(calls.assign).toBeUndefined();

    fail.assign = true;
    const id = '11111111-1111-4111-8111-111111111111';
    const refused = ctxOf('AssignAgent', { userId: id, message: 'for {{name}}' });
    expect(await node.execute(refused.ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(refused.notes[0]).toContain('assignment failed');
    expect(calls.assign![0]).toEqual([
      7,
      { conversationUuid: 'conv-1', userId: id, note: 'for Asha' },
    ]);
  });

  it('Deal: success leaves by created and stores the id; any failure leaves by error', async () => {
    const { node, fail } = await build();
    const stage = '22222222-2222-4222-8222-222222222222';
    const ok = ctxOf('Deal', { stageId: stage, saveAs: 'lead' });
    expect(await node.execute(ok.ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(ok.ctx.run.vars.lead).toBe('deal-1');

    fail.deal = true;
    expect(await node.execute(ctxOf('Deal', { stageId: stage }).ctx)).toEqual({
      kind: 'advance',
      port: 2,
    });
    expect(await node.execute(ctxOf('Deal', {}).ctx)).toEqual({ kind: 'advance', port: 2 });
    expect(await node.execute(ctxOf('Deal', { stageId: 'nope' }).ctx)).toEqual({
      kind: 'advance',
      port: 2,
    });
  });

  it('Notify: sends the mirrored message to the number through the number sender', async () => {
    const { node, calls } = await build();
    const { ctx } = ctxOf('NotifyNumber', { copyNumber: '+1 555 0100' });
    expect(await node.execute(ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(calls.number![0]).toEqual([
      expect.objectContaining({ orgId: 7 }),
      '15550100',
      { kind: 'text', body: 'Hello' },
      'flow:r:1:n:copy',
    ]);
  });

  it('Instagram: sends the link to the customer; a down channel halts, other failures move on', async () => {
    const { node } = await build();
    const a = ctxOf('WaToInstagram', { igUsername: 'acme', introText: '' });
    expect(await node.execute(a.ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(a.sent).toEqual([{ kind: 'text', body: 'https://ig.me/m/acme' }]);

    const down = ctxOf('WaToInstagram', { igUsername: 'acme' });
    down.ctx.send = async () => ({ ok: false, code: 'X', error: 'channel down', halt: true });
    expect(await node.execute(down.ctx)).toEqual({ kind: 'halt', reason: 'channel down' });

    const refused = ctxOf('WaToInstagram', { igUsername: 'acme' });
    refused.ctx.send = async () => ({ ok: false, code: 'X', error: 'blocked', halt: false });
    expect(await node.execute(refused.ctx)).toEqual({ kind: 'advance', port: 1 });
    expect(refused.notes[0]).toContain('blocked');
  });
});
