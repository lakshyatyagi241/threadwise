import { describe, expect, it } from 'vitest';
import {
  FLB_NODE_TYPE_LIST,
  flbDefaultNodeData,
  flbNormalizeGraph,
  flbRuntimeNodeData,
  type FlowGraph,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';

/**
 * The FLB hook inside `compileGraph` (WD-FLB-070 + WD-FLR-013): a graph exactly as the editor saves it (WaDesk's builder field names)
 * goes through the REAL compiler, with no reader shaping in front of it, and the executors get the names they read. All 60 node types
 * of the catalogue are compiled; the ten that used to misbehave are asserted by the name each executor reads.
 */

type Rec = Record<string, unknown>;

const UUID_A = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const graphOf = (type: string, save: Rec = {}): FlowGraph =>
  flbNormalizeGraph({
    flowNodes: [
      { id: 't', type: 'trigger', x: 0, y: 0, data: flbDefaultNodeData('trigger'), isStart: true },
      { id: 'n1', type, x: 0, y: 0, data: { ...flbDefaultNodeData(type), ...save } },
    ],
    flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'n1' }],
  });

const nodeOf = (type: string, save: Rec = {}) =>
  compileGraph(graphOf(type, save)).nodes.find((n) => n.id === 'n1')!;
/** What an executor sees: the compiled props, with the raw `data` bag (types the compiler does not shape) merged flat. */
const readOf = (type: string, save: Rec = {}): Rec => {
  const n = nodeOf(type, save);
  return { ...n.props, ...((n.props.data ?? {}) as Rec) };
};

describe('compileGraph with the FLB hook: all 60 catalogue types', () => {
  it('covers 60 types', () => {
    expect(FLB_NODE_TYPE_LIST).toHaveLength(60);
  });

  it.each(FLB_NODE_TYPE_LIST.map((d) => d.id))(
    '%s: compiles, keeps its id, and the reader shaping in front of it changes nothing',
    (type) => {
      const g = graphOf(type);
      const direct = compileGraph(g);
      expect(direct.nodes.find((n) => n.id === 'n1')).toBeDefined();
      expect(direct.nodes).toHaveLength(2);
      expect(compileGraph(flbRuntimeNodeData(g))).toEqual(direct);
      // never throws on an empty bag either
      expect(() =>
        compileGraph({ flowNodes: [{ id: 'x', type, data: {} }], flowEdges: [] }),
      ).not.toThrow();
    },
  );
});

describe('the ten types that misbehaved now reach the executors with the runtime names', () => {
  it('ai: the reply variable, the extraction fields, the assistant', () => {
    expect(
      readOf('ai', { save: 'answer', fields: 'a, b', extract: true, assistant: '9' }),
    ).toMatchObject({
      variable: 'answer',
      fields: ['a', 'b'],
      assistant_id: 9,
    });
    // an editor uuid is never cast to a number: it stays under `assistant` for the executor to resolve
    const r = readOf('ai', { assistant: UUID_A });
    expect(r.assistant).toBe(UUID_A);
    expect(r.assistant_id).toBeNull();
  });

  it('chatbot: the agent', () => {
    expect(readOf('chatbot', { bot: UUID_A })).toMatchObject({ agentId: UUID_A, botId: UUID_A });
  });

  it('subflow: the target flow', () => {
    expect(readOf('subflow', { flow: UUID_A })).toMatchObject({
      flowId: UUID_A,
      selectedFlowId: UUID_A,
    });
  });

  it('webhook, code and mysql: the variable the result is saved to', () => {
    expect(readOf('webhook', { save: 'api' }).variable).toBe('api');
    expect(readOf('code', { save: 'out' }).variable).toBe('out');
    expect(readOf('mysql', { save: 'rows2' }).variable).toBe('rows2');
  });

  it('poll: multiple answers', () => {
    expect(nodeOf('poll', { multi: true }).props.allowMultiple).toBe(true);
    expect(nodeOf('poll', { multi: false }).props.allowMultiple).toBe(false);
  });

  it('location: the coordinates are sent, not 0,0', () => {
    expect(nodeOf('location', { lat: '12.97', lng: '77.59' }).props).toMatchObject({
      latitude: 12.97,
      longitude: 77.59,
    });
  });

  it('cta: the legacy single-kind shape becomes an action', () => {
    const g = {
      flowNodes: [
        { id: 'c', type: 'cta', data: { kind: 'url', url: 'https://x.io', label: 'Go' } },
      ],
      flowEdges: [],
    };
    expect(compileGraph(g).nodes[0]!.props.actions).toEqual([
      { type: 'url', label: 'Go', value: 'https://x.io' },
    ]);
  });

  it('template: an integer id keeps templateId, an editor uuid reaches the node as templateUuid', () => {
    expect(nodeOf('template', { tpl: 'welcome', tplId: '5' }).props).toMatchObject({
      templateName: 'welcome',
      templateId: 5,
    });
    const u = nodeOf('template', { tpl: 'welcome', tplId: UUID_A.toUpperCase() }).props;
    expect(u).toMatchObject({ templateName: 'welcome', templateId: 0, templateUuid: UUID_A });
    expect(nodeOf('template', { tpl: 'welcome', tplId: null }).props).not.toHaveProperty(
      'templateUuid',
    );
  });
});

describe('flows that already use the runtime names compile as before', () => {
  const compile = (type: string, data: Rec) =>
    compileGraph({ flowNodes: [{ id: 'x', type, data }], flowEdges: [] }).nodes[0]!.props;

  it('location, poll, cta, template, notify and shop keep their runtime-named fields', () => {
    expect(compile('location', { latitude: 1.5, longitude: 2.5 })).toMatchObject({
      latitude: 1.5,
      longitude: 2.5,
    });
    expect(
      compile('poll', { question: 'q', options: ['a', 'b'], allowMultiple: true }),
    ).toMatchObject({
      allowMultiple: true,
    });
    expect(
      compile('cta', { ctaActions: [{ type: 'phone', label: 'Call', value: '+1' }] }).actions,
    ).toEqual([{ type: 'phone', label: 'Call', value: '+1' }]);
    expect(compile('template', { templateName: 'order', templateId: 4 })).toMatchObject({
      templateName: 'order',
      templateId: 4,
    });
    expect(
      (compile('notify_number', { mediaKind: 'image', source: 'custom' }).data as Rec).kind,
    ).toBe('image');
    expect(
      compile('whatsapp_shop', { productItems: [{ retailerId: 'r1', priceMinor: 5 }] }).products,
    ).toEqual([{ retailerId: 'r1', name: '', image: '', priceMinor: 5, currency: '', url: '' }]);
  });
});
