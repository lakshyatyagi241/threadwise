import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import { CrmNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/crm/crm-nodes';
import {
  listConfig,
  sessionOpen,
  updateFieldConfig,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/crm/crm-rules';

const render = (t: unknown) =>
  String(t ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => ({ city: 'Pune' })[k] ?? '');
const SEG = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('rules', () => {
  it('update field: key from the field, value rendered; no field is no step', () => {
    expect(updateFieldConfig({ field: ' city ', value: '{{city}}!' }, render)).toEqual({
      field: 'city',
      value: 'Pune!',
    });
    expect(updateFieldConfig({ field: '{{ city }}', value: 'x' }, render)?.field).toBe('city');
    expect(updateFieldConfig({ value: 'x' }, render)).toBeNull();
  });

  it('list: add by default, remove when asked, uuid or name', () => {
    expect(listConfig({ listId: 'g1', list: 'VIP' })).toEqual({
      action: 'add',
      groupId: 'g1',
      name: 'VIP',
    });
    expect(listConfig({ action: 'Remove' }).action).toBe('remove');
  });

  it('session: open inside the hours, closed after, closed for a customer who never wrote', () => {
    const now = new Date('2026-10-08T12:00:00Z');
    expect(sessionOpen(new Date('2026-10-08T00:00:00Z'), undefined, now)).toBe(true);
    expect(sessionOpen(new Date('2026-10-07T11:00:00Z'), undefined, now)).toBe(false);
    expect(sessionOpen(new Date('2026-10-07T11:00:00Z'), 48, now)).toBe(true);
    expect(sessionOpen(null, 24, now)).toBe(false);
    expect(sessionOpen(new Date('2026-10-08T11:30:00Z'), 'junk', now)).toBe(true);
  });
});

function build(over: Record<string, unknown> = {}) {
  const contacts = { setFieldFromFlow: vi.fn().mockResolvedValue({ stored: 'Pune' }) };
  const groups = {
    applyFromFlow: vi.fn().mockResolvedValue({ groupUuid: 'g', groupName: 'VIP', changed: true }),
    hasMemberFromFlow: vi.fn().mockResolvedValue(true),
  };
  const segments = { containsContactFromFlow: vi.fn().mockResolvedValue(true) };
  const conversations = {
    findThread: vi.fn().mockResolvedValue({ lastInboundAt: new Date(Date.now() - 3_600_000) }),
  };
  Object.assign({ contacts, groups, segments, conversations }, over);
  const node = new CrmNodes(
    contacts as never,
    groups as never,
    segments as never,
    conversations as never,
  );
  const notes: string[] = [];
  const mk = (type: string, d: Record<string, unknown>, run: Record<string, unknown> = {}) => ({
    run: {
      orgId: 7,
      contactId: 40,
      channelUuid: 'c',
      peerKey: 'p',
      vars: {} as Record<string, unknown>,
      ...run,
    },
    node: { id: 'n', type, props: { data: d } },
    render,
    note: (t: string) => notes.push(t),
    now: () => new Date(),
  });
  return { node, contacts, groups, segments, conversations, mk, notes };
}

describe('the CRM nodes', () => {
  it('update contact sets the field, mirrors it into the run variables and moves on', async () => {
    const { node, contacts, mk } = build();
    const ctx = mk('UpdateContact', { field: 'city', value: '{{city}}' });
    expect(await node.execute(ctx as never)).toEqual({ kind: 'advance', port: 1 });
    expect(contacts.setFieldFromFlow).toHaveBeenCalledWith(7, 40, 'city', 'Pune');
    expect(ctx.run.vars.city).toBe('Pune');
  });

  it('update contact skips with a note: no field, no contact, a field the CRM refuses, a throw', async () => {
    const a = build();
    expect(await a.node.execute(a.mk('UpdateContact', {}) as never)).toEqual({
      kind: 'advance',
      port: 1,
    });
    const b = build();
    await b.node.execute(b.mk('UpdateContact', { field: 'x' }, { contactId: null }) as never);
    expect(b.contacts.setFieldFromFlow).not.toHaveBeenCalled();
    const c = build();
    c.contacts.setFieldFromFlow.mockResolvedValue(null);
    const cc = c.mk('UpdateContact', { field: 'nope', value: 'v' });
    await c.node.execute(cc as never);
    expect(cc.run.vars.nope).toBeUndefined();
    expect(c.notes[0]).toMatch(/could not be set/);
    const d = build();
    d.contacts.setFieldFromFlow.mockRejectedValue(new Error('db down'));
    expect(await d.node.execute(d.mk('UpdateContact', { field: 'x' }) as never)).toEqual({
      kind: 'advance',
      port: 1,
    });
    expect(d.notes[0]).toMatch(/db down/);
  });

  it('list member adds or removes and always moves on', async () => {
    const { node, groups, mk } = build();
    await node.execute(mk('ListMember', { action: 'remove', listId: 'g1' }) as never);
    expect(groups.applyFromFlow).toHaveBeenCalledWith(7, 40, 'remove', { groupId: 'g1', name: '' });
    const none = mk('ListMember', {});
    expect(await node.execute(none as never)).toEqual({ kind: 'advance', port: 1 });
    groups.applyFromFlow.mockRejectedValue(new Error('gone'));
    expect(await node.execute(mk('ListMember', { listId: 'g1' }) as never)).toEqual({
      kind: 'advance',
      port: 1,
    });
  });

  it('conditions answer yes on port 1 and no on port 2, and no when they cannot tell', async () => {
    const { node, groups, segments, mk } = build();
    expect(await node.execute(mk('InList', { listId: 'g' }) as never)).toMatchObject({ port: 1 });
    groups.hasMemberFromFlow.mockResolvedValue(false);
    expect(await node.execute(mk('InList', { listId: 'g' }) as never)).toMatchObject({ port: 2 });
    expect(await node.execute(mk('InList', {}) as never)).toMatchObject({ port: 2 });
    expect(await node.execute(mk('InSegment', { segmentId: SEG }) as never)).toMatchObject({
      port: 1,
    });
    expect(await node.execute(mk('InSegment', { segmentId: 'bad' }) as never)).toMatchObject({
      port: 2,
    });
    segments.containsContactFromFlow.mockRejectedValue(new Error('x'));
    expect(await node.execute(mk('InSegment', { segmentId: SEG }) as never)).toMatchObject({
      port: 2,
    });
    expect(
      await node.execute(mk('InList', { listId: 'g' }, { contactId: null }) as never),
    ).toMatchObject({ port: 2 });
  });

  it('WhatsApp session is yes inside the window and no outside or with no channel', async () => {
    const { node, conversations, mk } = build();
    expect(await node.execute(mk('WaSession', {}) as never)).toMatchObject({ port: 1 });
    conversations.findThread.mockResolvedValue({
      lastInboundAt: new Date(Date.now() - 30 * 3_600_000),
    });
    expect(await node.execute(mk('WaSession', {}) as never)).toMatchObject({ port: 2 });
    expect(await node.execute(mk('WaSession', { hours: 48 }) as never)).toMatchObject({ port: 1 });
    expect(await node.execute(mk('WaSession', {}, { channelUuid: null }) as never)).toMatchObject({
      port: 2,
    });
  });
});

describe('compile', () => {
  it('maps the five builder types and routes yes and no', () => {
    const g = compileGraph({
      flowNodes: [
        { id: 'u', type: 'update_contact', data: { field: 'city', value: 'x' } },
        { id: 'l', type: 'list_member', data: { action: 'add', listId: 'g' } },
        { id: 'a', type: 'in_list', data: { listId: 'g' } },
        { id: 'b', type: 'in_segment', data: { segmentId: SEG } },
        { id: 'c', type: 'wa_session', data: {} },
        { id: 'y', type: 'end', data: {} },
        { id: 'n', type: 'end', data: {} },
      ],
      flowEdges: [
        { source: 'a', sourceHandle: 'yes', target: 'y' },
        { source: 'a', sourceHandle: 'no', target: 'n' },
      ],
    });
    expect(g.nodes.map((n) => n.type)).toEqual([
      'UpdateContact',
      'ListMember',
      'InList',
      'InSegment',
      'WaSession',
      'End',
      'End',
    ]);
    expect(g.edges).toEqual([
      { from: 'a_1', to: 'y' },
      { from: 'a_2', to: 'n' },
    ]);
  });
});
