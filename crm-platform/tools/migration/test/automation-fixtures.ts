/**
 * INVENTED advanced automations for the tests. The SHAPES follow the real staging dumps (node map with class / function / type /
 * edges / nodeObjectData, uiObject.cells with positions, triggerObjects, journey rows with parent_nodeId for the runtime's event
 * triggers, numbers in Extended JSON); every id, name, value and "key" here is made up (the keys are fake strings in the shape of
 * vendor keys). Node types, classes and functions are the real ones, plus a few unknown ones to test the placeholders.
 */
import { O } from './fixtures';

type J = Record<string, unknown>;
const D = (iso: string): J => ({ $date: iso });
const I = (n: number): J => ({ $numberInt: String(n) });

export const FAKE_TOKEN = 'sk-FAKEFAKEFAKEFAKEFAKEFAKE0042';
export const FAKE_SHEET_TOKEN = 'ya29.FAKE-FAKE-FAKE-FAKE-FAKE-FAKE-0007';

export const nid = (n: number): string =>
  `${n.toString(16).padStart(8, '0')}-1111-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const autoId = (n: number): string =>
  `auto-${n.toString().padStart(4, '0')}-0000-4000-8000-0000000000`;

let seq = 9_000_000;
const oid = (): J => O(seq++);

export interface WNodeOpts {
  type: 'trigger' | 'action' | 'condition' | string;
  cls: string;
  fn: string;
  data?: J;
  edges?: Array<[string, string]>; // [port, to]
}
export const wnode = (o: WNodeOpts): J => ({
  type: o.type,
  class: o.cls,
  function: o.fn,
  nodeObjectData: o.data ?? {},
  edges: (o.edges ?? []).map(([port, to]) => ({ class: 'x', function: 'y', port, to })),
});

export const rule = (field: string, operator: string, value = ''): J => ({
  id: `r-${field}`,
  field,
  operator,
  value,
  valueSource: 'value',
});
export const fq = (rules: J[], combinator = 'and', not = false): J => ({
  id: 'g1',
  combinator,
  not,
  rules,
});

const cell = (id: string, x: number, y: number): J => ({
  id,
  type: 'Action.whatsapp-send',
  position: { x: I(x), y: I(y) },
  size: { width: I(200), height: I(80) },
  ports: { items: [] },
});

export interface MetaOpts {
  n: number;
  name?: string;
  nodes: Record<string, J>;
  triggers?: string[];
  cells?: boolean | string[];
  status?: string;
  updated?: string;
  extra?: J;
  noId?: boolean;
}
export function meta(o: MetaOpts): J {
  const ids = Object.keys(o.nodes);
  const withCells = o.cells === false ? [] : Array.isArray(o.cells) ? o.cells : ids;
  return {
    _id: oid(),
    ...(o.noId ? {} : { automationId: autoId(o.n) }),
    name: o.name ?? `Automation ${o.n}`,
    description: '',
    createdBy: 'user-0001',
    createdOn: D('2026-02-01T08:00:00Z'),
    updatedBy: 'user-0001',
    updatedOn: D(o.updated ?? '2026-03-05T09:30:00Z'),
    status: o.status ?? 'published',
    is_active: true,
    isLocked: false,
    publishedOn: o.status === 'unpublished' ? null : D('2026-02-02T08:00:00Z'),
    version: I(3),
    versionedAt: D('2026-02-02T08:00:00Z'),
    activeCount: I(4),
    enteredCount: I(40),
    finishedCount: I(30),
    failedCount: I(2),
    goalCount: I(0),
    nodes: o.nodes,
    triggerObjects:
      o.triggers ?? ids.filter((i) => (o.nodes[i] as J).type === 'trigger').slice(0, 1),
    uiObject: { cells: withCells.map((id, i) => cell(id, 100 + i * 250, 100)) },
    ...o.extra,
  };
}

const TPL_ID = 'tpl-0001';
const comps = (): J => ({
  body: {
    value: [
      { index: '1', key: 'first_name', resolve_index: '1', value: 'x' },
      { index: '2', key: 'city', resolve_index: '2', value: 'y' },
    ],
  },
  button: {
    type: 'cta',
    value: [
      { index: '0', sub_type: 'URL', text: 'Open', value: 'link', disable: false },
      { index: '1', sub_type: 'PHONE_NUMBER', text: 'Call', value: '1', disable: false },
    ],
  },
});

export const MKL_ID = 'mkl-0001';
export const MKL_UNKNOWN = 'mkl-9999';

/** node ids by role, for the assertions */
export const A1 = {
  t: nid(101),
  c: nid(102),
  s: nid(103),
  l: nid(104),
  u1: nid(105),
  u2: nid(106),
  d: nid(107),
  s2: nid(108),
};

export function acmeAutomations(): Record<string, J[]> {
  const metas: J[] = [];
  const journey: J[] = [];

  // A1: field_match trigger -> 3-rule AND condition -> send (sent fans out to a list and an update, delivered / failed detached) -> delay -> send
  metas.push(
    meta({
      n: 1,
      name: 'Welcome series',
      cells: [A1.t, A1.c, A1.s, A1.l, A1.u1, A1.u2, A1.d], // s2 has no position
      nodes: {
        [A1.t]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'field_match',
          data: {
            filter_query: fq([rule('ready_status', 'notNull')]),
            mongodb_query: '{"ready_status":{"$ne":null}}',
            is_action_trigger: true,
          },
          edges: [['field_match', A1.c]],
        }),
        [A1.c]: wnode({
          type: 'condition',
          cls: 'contact',
          fn: 'query',
          data: {
            filter_query: fq([
              rule('city', 'notNull'),
              rule('tags', 'contains', 'vip'),
              rule('plan', '=', 'gold'),
            ]),
            mongodb_query: '{}',
          },
          edges: [['true', A1.s]],
        }),
        [A1.s]: wnode({
          type: 'action',
          cls: 'whatsapp',
          fn: 'send',
          data: { whatsappTemplateId: TPL_ID, broadcast_template_id: TPL_ID, components: comps() },
          edges: [
            ['sent', A1.l],
            ['sent', A1.u1],
            ['delivered', A1.u2],
            ['failed', A1.u2],
          ],
        }),
        [A1.l]: wnode({
          type: 'action',
          cls: 'list',
          fn: 'add',
          data: { marketing_list_id: MKL_ID },
        }),
        [A1.u1]: wnode({
          type: 'action',
          cls: 'contact',
          fn: 'update',
          data: {
            fields: [
              { ready_status: { label: 'Ready', template: 'sent' } },
              { stage: { label: 'Stage', template: '{{name}}' } },
            ],
            localValues: { fields: [] },
          },
        }),
        [A1.u2]: wnode({
          type: 'action',
          cls: 'contact',
          fn: 'update',
          data: { fields: [{ ready_status: { label: 'Ready', template: 'late' } }] },
          edges: [['', A1.d]],
        }),
        [A1.d]: wnode({
          type: 'action',
          cls: 'delay',
          fn: 'add',
          data: { delay: I(86400) },
          edges: [['afterDelay', A1.s2]],
        }),
        [A1.s2]: wnode({
          type: 'action',
          cls: 'whatsapp',
          fn: 'send',
          data: {
            whatsappTemplateId: 'tpl-unknown',
            broadcast_template_id: 'tpl-unknown',
            components: { body: { value: [] }, button: { type: 'cta', value: [] } },
          },
        }),
      },
    }),
  );
  for (const [id, n] of Object.entries(metas[0]!.nodes as Record<string, J>)) {
    journey.push({
      _id: oid(),
      automationId: autoId(1),
      nodeId: id,
      shapeId: 'Shape_x',
      type: n.type,
      class: n.class,
      function: n.function,
      edges: n.edges,
      nodeObjectData: n.nodeObjectData,
    });
  }
  // the runtime's own event triggers under the first send
  for (const ev of ['sent', 'delivered', 'failed'])
    journey.push({
      _id: oid(),
      automationId: autoId(1),
      nodeId: nid(900 + ev.length),
      shapeId: 'Shape_ev',
      type: 'trigger',
      class: 'whatsapp',
      function: ev,
      parent_nodeId: A1.s,
      edges: [],
      nodeObjectData: { is_action_trigger: true, whatsappTemplateId: TPL_ID },
    });

  // A2: date match (before 1, 11:00 AM) -> send
  const a2t = nid(201),
    a2s = nid(202);
  metas.push(
    meta({
      n: 2,
      name: 'Birthday',
      nodes: {
        [a2t]: wnode({
          type: 'trigger',
          cls: 'Datematch',
          fn: 'date_match',
          data: {
            field_name: 'dob',
            execution_cycle: 'once',
            date_of_execution: 'before',
            execution_offset: I(1),
            execution_time: '11:00 AM',
          },
          edges: [['date_match', a2s]],
        }),
        [a2s]: wnode({
          type: 'action',
          cls: 'whatsapp',
          fn: 'send',
          data: { whatsappTemplateId: TPL_ID, broadcast_template_id: TPL_ID, components: comps() },
        }),
      },
    }),
  );
  journey.push({
    _id: oid(),
    automationId: autoId(2),
    nodeId: a2t,
    type: 'trigger',
    class: 'Datematch',
    function: 'date_match',
    edges: [],
    nodeObjectData: {},
  });
  journey.push({
    _id: oid(),
    automationId: autoId(2),
    nodeId: a2s,
    type: 'action',
    class: 'contact',
    function: 'update',
    edges: [],
    nodeObjectData: {},
  }); // diverges: the definition says whatsapp.send
  // an older duplicate of A2 (latest only)
  metas.push(
    meta({
      n: 2,
      name: 'Birthday (old)',
      updated: '2026-01-01T00:00:00Z',
      nodes: {
        [nid(211)]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'added_to_list',
          data: { marketing_list_id: MKL_ID },
        }),
      },
    }),
  );

  // A3: a sheet trigger (no WaDesk equivalent, with a token in its config) -> save contact from sheet -> sheet query -> send
  const a3 = [nid(301), nid(302), nid(303), nid(304)] as const;
  metas.push(
    meta({
      n: 3,
      name: 'Sheet intake',
      nodes: {
        [a3[0]]: wnode({
          type: 'trigger',
          cls: 'google',
          fn: 'google_sheet_events',
          data: {
            googleAccount: 'acct-1',
            googleSheet: { id: 'sheet-1', name: 'Leads' },
            mobile_contact_number: 'Phone',
            accessToken: FAKE_SHEET_TOKEN,
          },
          edges: [['row_added_or_updated', a3[1]]],
        }),
        [a3[1]]: wnode({
          type: 'action',
          cls: 'google',
          fn: 'save_contact_from_sheet',
          data: {
            actionType: 'create',
            googleAccount: 'acct-1',
            googleSheet: { id: 'sheet-1', name: 'Leads' },
            googleSheetName: 'Sheet1',
            localValues: { primaryContact: { column: { id: 'c1', label: 'Phone' } }, mappings: [] },
            mappings: [
              { column: 'A', columnLabel: 'Name', contactField: 'name', source: 'google_sheet' },
              { column: 'B', columnLabel: 'Phone', contactField: 'phone', source: 'google_sheet' },
            ],
          },
          edges: [['saved', a3[2]]],
        }),
        [a3[2]]: wnode({
          type: 'condition',
          cls: 'google',
          fn: 'google_sheet_query',
          data: { filter_query: fq([rule('name', 'notNull'), rule('city', 'beginsWith', 'M')]) },
          edges: [['true', a3[3]]],
        }),
        [a3[3]]: wnode({
          type: 'action',
          cls: 'whatsapp',
          fn: 'send',
          data: { whatsappTemplateId: TPL_ID, broadcast_template_id: TPL_ID, components: comps() },
        }),
      },
    }),
  );
  for (const [id, n] of Object.entries(metas[metas.length - 1]!.nodes as Record<string, J>))
    journey.push({
      _id: oid(),
      automationId: autoId(3),
      nodeId: id,
      type: n.type,
      class: n.class,
      function: n.function,
      edges: n.edges,
      nodeObjectData: n.nodeObjectData,
    });

  // A4: added_to_list (resolves) -> in-list condition (unknown list) -> send; a second trigger (extra) -> send
  const a4 = [nid(401), nid(402), nid(403), nid(404)] as const;
  metas.push(
    meta({
      n: 4,
      name: 'List joined',
      triggers: [a4[0], a4[3]],
      nodes: {
        [a4[0]]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'added_to_list',
          data: { marketing_list_id: MKL_ID },
          edges: [['added_to_list', a4[1]]],
        }),
        [a4[1]]: wnode({
          type: 'condition',
          cls: 'list',
          fn: 'query',
          data: { marketingListId: MKL_UNKNOWN },
          edges: [['true', a4[2]]],
        }),
        [a4[2]]: wnode({
          type: 'action',
          cls: 'whatsapp',
          fn: 'send',
          data: { whatsappTemplateId: TPL_ID, broadcast_template_id: TPL_ID, components: comps() },
        }),
        [a4[3]]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'field_match',
          data: { filter_query: fq([rule('x', 'notNull')]) },
          edges: [['field_match', a4[2]]],
        }),
      },
    }),
  );

  // A5: OR + NOT trigger query (cannot be a field-match trigger), unknown action (with a secret), unknown condition, unsupported operator, nested group
  const a5 = [nid(501), nid(502), nid(503), nid(504), nid(505)] as const;
  metas.push(
    meta({
      n: 5,
      name: 'Odd ones',
      nodes: {
        [a5[0]]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'field_match',
          data: { filter_query: fq([rule('a', 'notNull'), rule('b', '=', '1')], 'or', true) },
          edges: [['field_match', a5[1]]],
        }),
        [a5[1]]: wnode({
          type: 'action',
          cls: 'sms',
          fn: 'send',
          data: { apiKey: FAKE_TOKEN, sender: 'ACME', message: 'hello there' },
          edges: [['sent', a5[2]]],
        }),
        [a5[2]]: wnode({
          type: 'condition',
          cls: 'ai',
          fn: 'classify',
          data: { prompt: 'x' },
          edges: [['true', a5[3]]],
        }),
        [a5[3]]: wnode({
          type: 'condition',
          cls: 'contact',
          fn: 'query',
          data: {
            filter_query: {
              combinator: 'or',
              not: false,
              rules: [
                rule('n', '>=', '5'),
                {
                  combinator: 'and',
                  not: true,
                  rules: [rule('p', 'null'), rule('q', 'doesNotContain', 'z')],
                },
              ],
            },
          },
          edges: [['true', a5[4]]],
        }),
        [a5[4]]: wnode({ type: 'action', cls: 'contact', fn: 'update', data: { fields: [] } }),
      },
    }),
  );

  // A6: an empty draft
  metas.push(meta({ n: 6, name: 'Draft', status: 'unpublished', nodes: {} }));
  journey.push({
    _id: oid(),
    automationId: autoId(6),
    nodeId: nid(601),
    type: 'action',
    class: 'contact',
    function: 'update',
    edges: [],
    nodeObjectData: {},
  });

  // A7: a cycle, a dangling edge, a fan-out, no layout, no triggerObjects
  const a7 = [nid(701), nid(702), nid(703)] as const;
  metas.push(
    meta({
      n: 7,
      name: 'Loop',
      cells: false,
      triggers: [],
      nodes: {
        [a7[0]]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'field_match',
          data: { filter_query: fq([rule('k', 'contains', 'z')]) },
          edges: [['field_match', a7[1]]],
        }),
        [a7[1]]: wnode({
          type: 'action',
          cls: 'contact',
          fn: 'update',
          data: { fields: [{ k: { label: 'K', template: 'a' } }] },
          edges: [['', a7[2]]],
        }),
        [a7[2]]: wnode({
          type: 'action',
          cls: 'contact',
          fn: 'update',
          data: { fields: [{ k: { label: 'K', template: 'b' } }] },
          edges: [
            ['', a7[1]],
            ['', 'ghost-node'],
          ],
        }),
      },
    }),
  );

  // A8: no trigger at all
  metas.push(
    meta({
      n: 8,
      name: 'No trigger',
      nodes: {
        [nid(801)]: wnode({
          type: 'action',
          cls: 'list',
          fn: 'add',
          data: { marketing_list_id: MKL_ID },
          edges: [['', nid(802)]],
        }),
        [nid(802)]: wnode({ type: 'action', cls: 'delay', fn: 'add', data: { delay: I(90) } }),
      },
    }),
  );

  // A9: too large (601 nodes); A10: large but fine (451 nodes in a chain)
  const big = (count: number): Record<string, J> => {
    const nodes: Record<string, J> = {};
    for (let i = 0; i < count; i++) {
      const id = nid(10_000 + i);
      nodes[id] =
        i === 0
          ? wnode({
              type: 'trigger',
              cls: 'contact',
              fn: 'field_match',
              data: { filter_query: fq([rule('z', 'notNull')]) },
              edges: [['field_match', nid(10_001)]],
            })
          : wnode({
              type: 'action',
              cls: 'delay',
              fn: 'add',
              data: { delay: I(60 * i) },
              edges: i + 1 < count ? [['afterDelay', nid(10_000 + i + 1)]] : [],
            });
    }
    return nodes;
  };
  metas.push(meta({ n: 9, name: 'Too large', nodes: big(601), cells: false }));
  metas.push(meta({ n: 10, name: 'Large', nodes: big(451), cells: false }));

  // A11: deleted; A12: no automationId
  metas.push(
    meta({
      n: 11,
      name: 'Deleted',
      extra: { is_deleted: true },
      nodes: {
        [nid(1101)]: wnode({
          type: 'trigger',
          cls: 'contact',
          fn: 'field_match',
          data: { filter_query: fq([rule('a', 'notNull')]) },
        }),
      },
    }),
  );
  metas.push(
    meta({
      n: 12,
      noId: true,
      nodes: {
        [nid(1201)]: wnode({ type: 'trigger', cls: 'contact', fn: 'field_match', data: {} }),
      },
    }),
  );

  // journey rows that match nothing
  journey.push({
    _id: oid(),
    automationId: 'ghost-auto',
    nodeId: nid(1301),
    type: 'action',
    class: 'contact',
    function: 'update',
    edges: [],
    nodeObjectData: {},
  });
  journey.push({
    _id: oid(),
    automationId: autoId(1),
    nodeId: nid(1302),
    type: 'action',
    class: 'contact',
    function: 'update',
    edges: [],
    nodeObjectData: {},
  });
  journey.push({
    _id: oid(),
    automationId: autoId(1),
    nodeId: A1.t,
    type: 'trigger',
    class: 'contact',
    function: 'field_match',
    edges: [],
    nodeObjectData: {},
  }); // a second row of the same node
  journey.push({
    _id: oid(),
    automationId: autoId(1),
    type: 'action',
    class: 'contact',
    function: 'update',
    edges: [],
    nodeObjectData: {},
  }); // no nodeId

  return {
    automation_metadata: metas,
    automation_journey: journey,
    marketing_list: [
      { _id: O(8_000_001), id: MKL_ID, name: 'VIP', created_time: D('2026-01-01T00:00:00Z') },
    ],
    broadcast_templates: [{ _id: O(8_000_002), id: TPL_ID, name: 'welcome_offer', language: 'en' }],
    contact_list: [],
  };
}
