import { describe, expect, it } from 'vitest';
import {
  flbExtractTrigger,
  flowState,
  flbFlowTypeOf,
  flbGraphStats,
  flbGridPosition,
  flbIsCatchAllKeywords,
  flbNormalizeAiGraph,
  flbNormalizeGraph,
  flbTriggerKeywordsTooLong,
  flbValidateGraph,
  flbWaitLabel,
  type FlbValidationNode,
} from '@crm/contracts';
import {
  decodeFlowCursor,
  encodeFlowCursor,
  likePattern,
  parseImportPayload,
  stateOf,
  statusPredicate,
  triggerLabel,
} from '../../../src/modules/flow-builder-editor/flow-rules';
import { flbExportFileName, flbSlugify } from '@crm/contracts';

const node = (id: string, type: string, data: Record<string, unknown> = {}, extra: Partial<FlbValidationNode> = {}) =>
  ({ id, type, data, ...extra }) as FlbValidationNode;

describe('pre-save validation (TW-FLB-018)', () => {
  const ctx = { mode: 'chat' as const, senderAvailable: false };

  it('an empty canvas is valid', () => {
    expect(flbValidateGraph([], [], ctx)).toEqual({ ok: true, items: [], badNodeIds: [] });
  });

  it('a Message node with no incoming edge is flagged "is not connected to anything"', () => {
    const r = flbValidateGraph([node('t', 'trigger'), node('m', 'message')], [], ctx);
    expect(r.ok).toBe(false);
    expect(r.items).toEqual(['"Send message" is not connected to anything.']);
    expect(r.badNodeIds).toEqual(['m']);
  });

  it('a node that only has outgoing edges reads "has no incoming connection"', () => {
    const r = flbValidateGraph(
      [node('t', 'trigger'), node('a', 'message'), node('b', 'message')],
      [{ source: 'a', target: 'b' }, { source: 't', target: 'b' }],
      ctx,
    );
    expect(r.items).toEqual(['"Send message" has no incoming connection — nothing leads into it.']);
  });

  it('a leaf with no outgoing edge is fine, and the trigger and start node are exempt', () => {
    const r = flbValidateGraph([node('t', 'trigger'), node('m', 'message')], [{ source: 't', target: 'm' }], ctx);
    expect(r.ok).toBe(true);
  });

  it('a Google Sheets node on a flow switched to Instagram is blocked with the channel reason', () => {
    const r = flbValidateGraph(
      [node('t', 'trigger', { channel: 'instagram' }), node('s', 'google_sheets')],
      [{ source: 't', target: 's' }],
      { mode: 'instagram', senderAvailable: false },
    );
    expect(r.items).toEqual([
      '"Google Sheets" does not work on Instagram — delete it or switch the channel back on the Trigger node.',
    ]);
  });

  it('any other channel names WhatsApp in the sentence (Reference quirk kept)', () => {
    const r = flbValidateGraph(
      [node('t', 'trigger'), node('c', 'cf_say')],
      [{ source: 't', target: 'c' }],
      { mode: 'telegram', senderAvailable: false },
    );
    expect(r.items[0]).toContain('does not work on WhatsApp');
  });

  it('hidden and unknown types are left alone by the channel check', () => {
    const r = flbValidateGraph(
      [node('t', 'trigger'), node('x', 'ig_send_dm'), node('y', 'brand_new_type')],
      [{ source: 't', target: 'x' }, { source: 't', target: 'y' }],
      { mode: 'chat', senderAvailable: false },
    );
    expect(r.ok).toBe(true);
  });

  it('a Trigger without a sender is blocked when the workspace has senders, and saves when it has none', () => {
    const blocked = flbValidateGraph([node('t', 'trigger', { deviceId: '' })], [], { mode: 'chat', senderAvailable: true });
    expect(blocked.items).toEqual(['The Trigger node has no number selected — pick one on the Trigger step.']);
    expect(flbValidateGraph([node('t', 'trigger', { deviceId: '' })], [], { mode: 'chat', senderAvailable: false }).ok).toBe(true);
    expect(
      flbValidateGraph([node('t', 'trigger', { deviceId: 'waba:1' })], [], { mode: 'chat', senderAvailable: true }).ok,
    ).toBe(true);
  });

  it('the sender check only applies to chat, Instagram and Facebook', () => {
    expect(flbValidateGraph([node('t', 'trigger')], [], { mode: 'telegram', senderAvailable: true }).ok).toBe(true);
    const ig = flbValidateGraph([node('t', 'trigger')], [], { mode: 'instagram', senderAvailable: true });
    expect(ig.items[0]).toContain('Instagram account');
  });
});

describe('boot normalisation (TW-FLB-015)', () => {
  it('backfills ids, types, coordinates and data under the saved data, and exactly one start (the trigger)', () => {
    const g = flbNormalizeGraph({
      flowNodes: [{ type: 'message', data: { text: 'hi' } }, { type: 'trigger' }, { id: 'z', x: 5, y: 6, type: 'end' }],
      flowEdges: [],
    });
    expect(g.flowNodes[0]).toMatchObject({ x: 120, y: 120, data: { text: 'hi' } });
    expect(g.flowNodes[1]).toMatchObject({ x: 380, y: 120, isStart: true });
    expect(g.flowNodes[2]).toMatchObject({ x: 5, y: 6 });
    expect(g.flowNodes.filter((n) => n.isStart)).toHaveLength(1);
    expect(g.flowNodes.every((n) => /^n_/.test(n.id) || n.id === 'z')).toBe(true);
  });

  it('with no trigger the first node is the start; several starts collapse to one', () => {
    expect(flbNormalizeGraph({ flowNodes: [{ type: 'message' }, { type: 'end' }] }).flowNodes[0]!.isStart).toBe(true);
    const g = flbNormalizeGraph({ flowNodes: [{ id: 'a', type: 'message', isStart: true }, { id: 'b', type: 'end', isStart: true }] });
    expect(g.flowNodes.filter((n) => n.isStart)).toHaveLength(1);
  });

  it('drops edges whose endpoints do not exist and defaults the handle to out', () => {
    const g = flbNormalizeGraph({
      flowNodes: [{ id: 'a', type: 'trigger' }, { id: 'b', type: 'message' }],
      flowEdges: [{ source: 'a', target: 'b' }, { source: 'a', target: 'ghost' }, { source: 'ghost', target: 'b' }],
    });
    expect(g.flowEdges).toHaveLength(1);
    expect(g.flowEdges[0]).toMatchObject({ source: 'a', target: 'b', sourceHandle: 'out' });
  });

  it('the grid places nodes 3 per row', () => {
    expect([0, 1, 2, 3].map(flbGridPosition)).toEqual([
      { x: 120, y: 120 },
      { x: 380, y: 120 },
      { x: 640, y: 120 },
      { x: 120, y: 300 },
    ]);
  });

  it('the AI path forces the start to the first trigger and falls back to (100, 200)', () => {
    const g = flbNormalizeAiGraph({ flowNodes: [{ id: 'a', type: 'message', isStart: true }, { id: 'b', type: 'trigger' }] });
    expect(g.flowNodes.map((n) => n.isStart)).toEqual([false, true]);
    expect(g.flowNodes[0]).toMatchObject({ x: 100, y: 200 });
  });

  it('flbFlowTypeOf: call stays call; otherwise the Trigger channel when available, else the opened type', () => {
    const nodes = [{ type: 'trigger', data: { channel: 'telegram' } }];
    expect(flbFlowTypeOf(nodes, 'call', ['chat', 'telegram'])).toBe('call');
    expect(flbFlowTypeOf(nodes, 'chat', ['chat', 'telegram'])).toBe('telegram');
    expect(flbFlowTypeOf(nodes, 'chat', ['chat'])).toBe('chat');
  });
});

describe('featured card numbers (TW-FLB-002)', () => {
  it('two delay nodes of 30 minutes and 2 hours read "~2.5 h total"', () => {
    const g = flbGraphStats({
      flowNodes: [
        { id: 'a', type: 'delay', x: 0, y: 0, data: { amount: 30, unit: 'min' } },
        { id: 'b', type: 'delay', x: 0, y: 0, data: { amount: 2, unit: 'hour' } },
      ],
      flowEdges: [],
    });
    expect(g.waitMinutes).toBe(150);
    expect(flbWaitLabel(g.waitMinutes)).toBe('~2.5 h total');
  });

  it('seconds round to at least one minute, days are 1440, and no delay reads "no waits"', () => {
    const s = (amount: number, unit: string) =>
      flbGraphStats({ flowNodes: [{ id: 'a', type: 'delay', x: 0, y: 0, data: { amount, unit } }], flowEdges: [] }).waitMinutes;
    expect(s(5, 'sec')).toBe(1);
    expect(s(120, 'sec')).toBe(2);
    expect(s(1, 'day')).toBe(1440);
    expect(flbWaitLabel(0)).toBe('no waits');
    expect(flbWaitLabel(45)).toBe('~45 min');
  });

  it('counts message-type nodes only', () => {
    const mk = (type: string) => ({ id: type, type, x: 0, y: 0, data: {} });
    const g = flbGraphStats({ flowNodes: ['message', 'template', 'media', 'buttons', 'list', 'cta', 'ask', 'tag'].map(mk), flowEdges: [] });
    expect(g.messages).toBe(6);
    expect(g.nodes).toBe(8);
  });
});

describe('trigger column extraction (TW-FLB-020)', () => {
  const t = (data: Record<string, unknown>) =>
    flbExtractTrigger(flbNormalizeGraph({ flowNodes: [{ id: 't', type: 'trigger', data }] }));

  it('tag_added with a waba sender reads kind, tag reference, engine and sender reference', () => {
    expect(t({ kind: 'tag_added', tagId: '7', deviceId: 'waba:3' })).toMatchObject({
      kind: 'tag_added', valueKind: 'tag', valueRef: '7', engine: 'waba', senderRef: '3',
    });
  });

  it('keywordMode any is the literal any; otherwise the trimmed keywords', () => {
    expect(t({ kind: 'keyword', keywordMode: 'any' }).keywords).toBe('any');
    expect(t({ kind: 'keyword', keywordMode: 'keywords', keywords: '  price, cost ' }).keywords).toBe('price, cost');
  });

  it('kinds without a value carry 0 and an unknown kind becomes keyword', () => {
    expect(t({ kind: 'order_placed' }).valueKind).toBe('zero');
    expect(t({ kind: 'nonsense' }).kind).toBe('keyword');
    expect(t({ kind: 'start' }).kind).toBe('keyword');
  });

  it('only a known engine prefix sets the engine; a bare value or an unknown prefix sets none', () => {
    expect(t({ deviceId: 'unofficial:2' }).engine).toBeNull();
    expect(t({ deviceId: '5' })).toMatchObject({ engine: null, senderRef: '5' });
    expect(t({ deviceId: 'BAILEYS:9' }).engine).toBe('baileys');
    expect(t({ deviceId: '' })).toMatchObject({ engine: null, senderRef: null });
  });

  it('comment_to_dm joins the rule ids; none means any rule', () => {
    expect(t({ kind: 'comment_to_dm', keywordRuleIds: ['a', 'b'] }).keywords).toBe('a,b');
    expect(t({ kind: 'comment_to_dm', keywordRuleIds: [] }).keywords).toBeNull();
  });

  it('a flow with no Trigger saves as keyword with no keywords', () => {
    expect(flbExtractTrigger({ flowNodes: [] })).toMatchObject({ kind: 'keyword', keywords: null, hasTrigger: false });
  });

  it('keywords over 255 characters produce Threadwise\'s message, and catch-all spellings are recognised', () => {
    expect(flbTriggerKeywordsTooLong('a'.repeat(255))).toBeNull();
    expect(flbTriggerKeywordsTooLong('a'.repeat(300))).toBe(
      "Trigger keyword is too long (300 characters; the limit is 255). Open the flow's Trigger node and shorten the keywords — remove duplicates or extra phrases.",
    );
    for (const k of ['*', '.*', '.+', 'any', ' ANY ']) expect(flbIsCatchAllKeywords(k)).toBe(true);
    expect(flbIsCatchAllKeywords('price')).toBe(false);
  });
});

describe('flow lifecycle and list rules (TW-FLB-001, 004)', () => {
  it('published and active is live, published and not active is paused, unpublished is always a draft', () => {
    expect(flowState({ isPublished: true, isActive: true })).toBe('live');
    expect(flowState({ isPublished: true, isActive: false })).toBe('paused');
    expect(flowState({ isPublished: false, isActive: false })).toBe('draft');
    expect(flowState({ isPublished: false, isActive: true })).toBe('draft');
    expect(stateOf(true, false)).toBe('paused');
  });

  it('the SQL predicates mirror the state split', () => {
    expect(statusPredicate('all')).toBeNull();
    expect(statusPredicate('live')).toBe('f.is_published AND f.is_active');
    expect(statusPredicate('paused')).toBe('f.is_published AND NOT f.is_active');
    expect(statusPredicate('draft')).toBe('NOT f.is_published');
  });

  it('the cursor round-trips and rejects junk; the search escapes LIKE wildcards', () => {
    const c = encodeFlowCursor('2026-10-02T08:04:59.737123Z', 42);
    expect(decodeFlowCursor(c)).toEqual({ updatedAtIso: '2026-10-02T08:04:59.737123Z', id: 42 });
    expect(() => decodeFlowCursor('garbage')).toThrow();
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('card trigger labels: only three kinds have their own, everything else reads Keyword (Reference quirk)', () => {
    expect(triggerLabel('tag_added')).toBe('Auto · on tag');
    expect(triggerLabel('group_join')).toBe('Auto · on group join');
    expect(triggerLabel('manual_enroll')).toBe('Manual enroll');
    expect(triggerLabel('contact_created')).toBe('Keyword');
  });
});

describe('export file names and import payloads (TW-FLB-008, 009)', () => {
  it('"Lead Nurture!" exports as lead-nurture.threadwise-flow.json and an unslugifiable name uses the id', () => {
    expect(flbSlugify('Lead Nurture!')).toBe('lead-nurture');
    expect(flbExportFileName('Lead Nurture!', 'x')).toBe('lead-nurture.threadwise-flow.json');
    expect(flbExportFileName('!!!', '77')).toBe('flow-77.threadwise-flow.json');
    expect(flbSlugify('Café Menü')).toBe('cafe-menu');
  });

  it('accepts the canonical wrapper and names the copy "<name> (imported)"', () => {
    const p = parseImportPayload(
      { _threadwise_flow_export: 1, name: 'Welcome', flow_type: 'telegram', category: 'welcome', flow_data: { flowNodes: [{ id: 'a', type: 'trigger' }], flowEdges: [] } },
      { suffix: ' (imported)' },
    );
    expect(p).toMatchObject({ name: 'Welcome (imported)', flowType: 'telegram', category: 'welcome' });
    expect(p.graph.flowNodes).toHaveLength(1);
  });

  it('accepts a bare graph, lays out nodes without coordinates on the 3-column grid, and defaults to "Imported flow" and chat', () => {
    const p = parseImportPayload(
      { flowNodes: [{ type: 'trigger' }, { type: 'message' }, { type: 'message' }, { type: 'end' }] },
      { suffix: ' (imported)' },
    );
    expect(p.name).toBe('Imported flow (imported)');
    expect(p.flowType).toBe('chat');
    expect(p.graph.flowNodes.map((n) => [n.x, n.y])).toEqual([[120, 120], [380, 120], [640, 120], [120, 300]]);
  });

  it('an unknown flow_type falls back to chat; a missing or non-array flowNodes is refused', () => {
    expect(parseImportPayload({ flow_type: 'fax', flow_data: { flowNodes: [] } }).flowType).toBe('chat');
    for (const bad of [{}, { flowNodes: 'x' }, { flow_data: {} }, [], 'text', null]) {
      expect(() => parseImportPayload(bad)).toThrow(/not a valid flow export/);
    }
  });

  it('unknown node types are kept as they are (no schema validation, as Reference)', () => {
    const p = parseImportPayload({ flowNodes: [{ id: 'q', type: 'from_the_future', data: { a: 1 } }] });
    expect(p.graph.flowNodes[0]).toMatchObject({ type: 'from_the_future', data: { a: 1 } });
  });
});
