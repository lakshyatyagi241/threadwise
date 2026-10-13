import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAutomationPlan, flowUuidOf, type MetaVerdict } from '../automation/plan';
import { clockOf, delayOf, MAPPING } from '../automation/convert';
import { scrub } from '../util';
import { customDumps, type Dumps } from './helpers';
import { A1, acmeAutomations, FAKE_SHEET_TOKEN, FAKE_TOKEN, MKL_ID } from './automation-fixtures';

let d: Dumps;
let plan: Awaited<ReturnType<typeof buildAutomationPlan>>;
const LIST = { id: 77, uuid: '00000000-0000-4000-8000-000000000077', table: 'contact_groups' };
type Loaded = Extract<MetaVerdict, { kind: 'load' }>;
const byName = (name: string): Loaded => {
  for (const v of plan.meta.values()) if (v.kind === 'load' && v.row.flow_name === name) return v;
  throw new Error(`no loaded automation named ${name}`);
};
const graph = (v: Loaded) => v.row.flow_data as { flowNodes: any[]; flowEdges: any[]; waboo: any };
const softOf = (v: Loaded, code: string) => v.soft.find((s) => s.code === code);
const input = () => ({
  source: d.source,
  client: 'acme',
  fallbackAt: '2026-06-01T00:00:00.000Z',
  ref: (c: string, k: unknown) => (c === 'marketing_list' && k === MKL_ID ? LIST : undefined),
});

beforeAll(async () => {
  d = await customDumps({ acme: acmeAutomations() });
  plan = await buildAutomationPlan(input());
});
afterAll(() => d.cleanup());

describe('the converter', () => {
  it('helpers: clock and delay', () => {
    expect(clockOf('11:00 AM')).toBe('11:00');
    expect(clockOf('12:30 AM')).toBe('00:30');
    expect(clockOf('09:15 PM')).toBe('21:15');
    expect(clockOf('17:30')).toBe('17:30');
    expect(clockOf('later')).toBeNull();
    expect(delayOf(86400)).toEqual({ amount: 1, unit: 'day' });
    expect(delayOf(7200)).toEqual({ amount: 2, unit: 'hour' });
    expect(delayOf(90)).toEqual({ amount: 90, unit: 'sec' });
  });

  it('the mapping table lists every real (type, class, function) of the staging dumps', () => {
    const real = [
      'action|whatsapp|send',
      'trigger|contact|field_match',
      'trigger|Datematch|date_match',
      'condition|contact|query',
      'trigger|contact|added_to_list',
      'condition|list|query',
      'action|google|save_contact_from_sheet',
      'action|contact|update',
      'action|delay|add',
      'action|list|add',
      'condition|google|google_sheet_query',
      'trigger|google|google_sheet_events',
    ];
    const keys = new Set(MAPPING.map((m) => m.key));
    for (const k of real) expect(keys.has(k), k).toBe(true);
  });

  it('A1: every node is converted, edges follow the ports, delivered / failed are detached, sent fans out', () => {
    const v = byName('Welcome series');
    const g = graph(v);
    const type = (id: string) =>
      g.flowNodes.find((n) => n.data._waboo?.id === id && n.data._waboo.role === undefined)?.type;
    expect(type(A1.t)).toBe('trigger');
    expect(type(A1.c)).toBe('condition');
    expect(type(A1.s)).toBe('template');
    expect(type(A1.l)).toBe('list_member');
    expect(type(A1.u1)).toBe('update_contact');
    expect(type(A1.d)).toBe('delay');
    // 8 Waboo nodes + 1 chained update + 2 detached placeholders (delivered, failed)
    expect(g.flowNodes).toHaveLength(8 + 1 + 2);
    // 8 Waboo edges that resolve (field_match, true, 4 on the send, u2 -> d, d -> s2) + 1 chain edge
    expect(g.flowEdges).toHaveLength(8 + 1);
    expect(g.flowNodes.filter((n) => n.type === 'trigger')).toHaveLength(1);
    expect(g.flowNodes.filter((n) => n.isStart)).toHaveLength(1);
    const ids = new Set(g.flowNodes.map((n) => n.id));
    for (const e of g.flowEdges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    const trig = g.flowNodes.find((n) => n.type === 'trigger');
    expect(trig.data).toMatchObject({
      kind: 'field_match',
      field: 'ready_status',
      operator: 'is_set',
    });
    expect(v.row.trigger_kind).toBe('field_match');
    expect(v.row.trigger_value).toBe(0);
    const cond = g.flowNodes.find((n) => n.type === 'condition');
    expect(cond.data.conditions.map((c: any) => c.operator)).toEqual([
      'exists',
      'contains',
      'equals',
    ]);
    expect(cond.data.operators).toEqual(['AND', 'AND']);
    const tpl = g.flowNodes.find((n) => n.type === 'template' && n.data._waboo.id === A1.s);
    expect(tpl.data.tpl).toBe('welcome_offer');
    const sendOut = g.flowEdges.filter((e) => e.source === tpl.id);
    expect(sendOut).toHaveLength(2); // the two `sent` edges, both from `out`
    expect(sendOut.every((e) => e.sourceHandle === 'out')).toBe(true);
    const detached = g.flowNodes.filter((n) => String(n.data._waboo.role).startsWith('detached'));
    expect(detached).toHaveLength(2);
    for (const x of detached) expect(g.flowEdges.some((e) => e.target === x.id)).toBe(false); // nobody reaches them
    expect(g.flowNodes.find((n) => n.data._waboo.id === A1.s2).data.tpl).toBe('');
    expect(g.flowNodes.find((n) => n.type === 'list_member').data.listId).toBe(LIST.uuid);
    expect(softOf(v, 'EVENT_BRANCH_DETACHED')?.detail).toBe(2);
    expect(softOf(v, 'FAN_OUT_FIRST_ONLY')?.detail).toBe(1);
    expect(softOf(v, 'TEMPLATE_VARIABLES_LOST')?.detail).toBe(2);
    expect(softOf(v, 'TEMPLATE_UNRESOLVED')?.detail).toBe(1);
    expect(softOf(v, 'LAYOUT_MISSING')?.detail).toBe(1);
    expect(softOf(v, 'AUTOMATION_STATE')?.detail).toMatchObject({
      status: 'published',
      is_active: true,
      entered: 40,
    });
    expect(g.waboo).toMatchObject({ wasActive: true, version: 3 });
  });

  it('safety: every loaded flow is unpublished AND inactive, nothing is armed', () => {
    let n = 0;
    for (const v of plan.meta.values())
      if (v.kind === 'load') {
        n++;
        expect(v.row.is_published).toBe(false);
        expect(v.row.is_active).toBe(false);
        expect(v.row.published_at).toBeNull();
        expect(v.row.category).toBe('Waboo automation');
        expect(v.row.trigger_keywords).toBeNull();
        expect('trigger_channel_id' in v.row || 'trigger_device_id' in v.row).toBe(false);
      }
    expect(n).toBeGreaterThan(5);
  });

  it('A2: date match -> date_field_match with days, direction and a 24-hour time', () => {
    const v = byName('Birthday');
    const trig = graph(v).flowNodes.find((n) => n.type === 'trigger');
    expect(trig.data).toMatchObject({
      kind: 'date_field_match',
      field: 'dob',
      direction: 'before',
      days: 1,
      time: '11:00',
      yearly: false,
    });
    expect(v.row.trigger_kind).toBe('date_field_match');
    expect(v.row.trigger_config).toMatchObject({
      field: 'dob',
      direction: 'before',
      days: 1,
      time: '11:00',
    });
  });

  it('A3: an unsupported trigger is an inert manual_enroll placeholder that keeps its type and a scrubbed config', () => {
    const v = byName('Sheet intake');
    const g = graph(v);
    const trig = g.flowNodes.find((n) => n.type === 'trigger');
    expect(trig.data.kind).toBe('manual_enroll');
    expect(trig.data._waboo).toMatchObject({
      placeholder: true,
      class: 'google',
      function: 'google_sheet_events',
    });
    expect(JSON.stringify(g)).not.toContain(FAKE_SHEET_TOKEN);
    expect(scrub(g).redacted).toEqual([]);
    expect(trig.data._waboo.config.googleSheet).toEqual({ id: 'sheet-1', name: 'Leads' });
    expect(trig.data._waboo.config.accessToken).toBeUndefined();
    expect(softOf(v, 'SECRET_SCRUBBED')).toBeTruthy();
    const sheet = g.flowNodes.find((n) => n.type === 'sheet_contact');
    expect(sheet.data.map).toEqual([
      { column: 'Name', field: 'name' },
      { column: 'Phone', field: 'phone' },
    ]);
    expect(sheet.data.matchColumn).toBe('Phone');
    expect(
      g.flowNodes.find((n) => n.type === 'condition').data.conditions.map((c: any) => c.operator),
    ).toEqual(['exists', 'starts_with']);
    expect(softOf(v, 'PLACEHOLDER_NODES')?.detail).toBe(1);
  });

  it('A4: group_join with the list id, an unknown list is soft, a second trigger is an inert placeholder', () => {
    const v = byName('List joined');
    const g = graph(v);
    expect(v.row.trigger_kind).toBe('group_join');
    expect(v.row.trigger_value).toBe(LIST.id);
    expect(g.flowNodes.find((n) => n.type === 'trigger').data.groupId).toBe(LIST.uuid);
    expect(g.flowNodes.find((n) => n.type === 'in_list').data.listId).toBe('');
    expect(softOf(v, 'LIST_UNRESOLVED')?.detail).toBe(1);
    expect(softOf(v, 'EXTRA_TRIGGER')?.detail).toBe(1);
    expect(g.flowNodes.filter((n) => n.type === 'trigger')).toHaveLength(1);
  });

  it('A5: OR / NOT trigger = manual_enroll + a Condition with the whole query; unknown nodes are placeholders; no secret survives', () => {
    const v = byName('Odd ones');
    const g = graph(v);
    expect(v.row.trigger_kind).toBe('manual_enroll');
    const split = g.flowNodes.find((n) => n.data._waboo.role === 'split_condition');
    expect(split.data.conditions).toHaveLength(2);
    expect(split.data.operators).toEqual(['OR']);
    const sms = g.flowNodes.find((n) => n.data._waboo.class === 'sms');
    expect(sms.type).toBe('update_contact');
    expect(sms.data.field).toBe('');
    expect(sms.data._waboo.config.sender).toBe('ACME');
    const ai = g.flowNodes.find((n) => n.data._waboo.class === 'ai');
    expect(ai.type).toBe('condition');
    expect(ai.data.conditions).toEqual([]);
    const nested = g.flowNodes.find((n) => n.data.conditionGroup);
    expect(nested.data.conditionGroup.op).toBe('or');
    expect(softOf(v, 'NESTED_NOT_DROPPED')).toBeTruthy();
    expect(softOf(v, 'OPERATOR_UNSUPPORTED')?.detail).toBe(1);
    expect(JSON.stringify(g)).not.toContain(FAKE_TOKEN);
    expect(softOf(v, 'SECRET_SCRUBBED')).toBeTruthy();
    // NOT swaps the port: the Waboo field_match port leaves from `no`
    expect(g.flowEdges.find((e) => e.source === split.id)!.sourceHandle).toBe('no');
  });

  it('A7: a cycle and a dangling edge are counted, never thrown; no layout falls back to a grid; a trigger is synthesised when missing', () => {
    const v = byName('Loop');
    expect(softOf(v, 'CYCLE_PRESENT')?.detail).toBe(1);
    expect(softOf(v, 'DANGLING_EDGES_DROPPED')?.detail).toBe(1);
    expect(softOf(v, 'LAYOUT_MISSING')?.detail).toBe(3);
    const w = byName('No trigger');
    const g = graph(w);
    expect(softOf(w, 'NO_TRIGGER')).toBeTruthy();
    expect(g.flowNodes.filter((n) => n.type === 'trigger')).toHaveLength(1);
    expect(g.flowNodes[0].data.kind).toBe('manual_enroll');
    expect(g.flowEdges.some((e) => e.source === g.flowNodes[0].id)).toBe(true);
  });

  it('huge documents: 601 nodes are quarantined, 451 load', () => {
    const verdicts = [...plan.meta.values()];
    expect(
      verdicts.filter((v) => v.kind === 'quarantine' && v.code === 'GRAPH_TOO_LARGE'),
    ).toHaveLength(1);
    expect(graph(byName('Large')).flowNodes).toHaveLength(451);
  });

  it('verdicts of the other documents', () => {
    const codes = [...plan.meta.values()].map((v) =>
      v.kind === 'load' ? 'load' : `${v.kind}:${v.code}`,
    );
    expect(codes.filter((c) => c === 'load')).toHaveLength(8);
    for (const c of [
      'exclude:NO_NODES',
      'exclude:OLDER_DUPLICATE',
      'exclude:SOFT_DELETED',
      'quarantine:NO_AUTOMATION_ID',
      'quarantine:GRAPH_TOO_LARGE',
    ])
      expect(
        codes.filter((x) => x === c),
        c,
      ).toHaveLength(1);
  });

  it('the journey rows: adopted, derived, or counted with a reason', () => {
    const t = plan.tally;
    expect(t['journey:adopt']).toBe(8 + 4 + 1); // A1 8 nodes + A3 4 + A2 trigger
    expect(t['journey:exclude:DERIVED_EVENT_NODE']).toBe(3);
    expect(t['journey:quarantine:JOURNEY_DIVERGES']).toBe(1);
    expect(t['journey:exclude:DUPLICATE_NODE']).toBe(1);
    expect(t['journey:quarantine:NO_DEFINITION']).toBe(1);
    expect(t['journey:quarantine:NOT_IN_DEFINITION']).toBe(1);
    expect(t['journey:quarantine:NO_NODE_ID']).toBe(1);
    expect(t['journey:exclude:AUTOMATION_NOT_IMPORTED']).toBe(1);
    for (const v of plan.journey.values())
      if (v.kind === 'adopt') expect(flowUuidOf('acme', v.metaKey)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is deterministic: the same dump gives the same fingerprint', async () => {
    expect((await buildAutomationPlan(input())).fingerprint).toBe(plan.fingerprint);
  });
});
