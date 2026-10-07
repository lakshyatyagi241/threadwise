import { describe, expect, it } from 'vitest';
import { applyImport, importToSimple } from './simple-import';
import { allSteps, emptyDoc, groupsOf, problems, toGraph, unreachable } from './simple-model';
import { isWaboExport, waboToGraph } from './wabo-import';

const MAIN = 'q-main';
const EDU = 'q-edu';
const node = (over: Record<string, unknown>) => ({
  botid: 'b',
  type: 'Flow',
  displayOrder: 0,
  name: 'Untitled',
  ...over,
});

const EXPORT = [
  // Intent / FAQ records: the flow's name and the words that start it (an FAQ with no journey is ignored)
  { type: 'Intent', qid: 'i1', query: 'hi', question: 'hi', journey: { qid: MAIN, name: 'Hello' } },
  {
    type: 'FAQ',
    qid: 'f1',
    query: 'faq',
    question: 'faq',
    node: null,
    response: [{ type: 'text', value: 'x' }],
  },
  node({
    nodeId: 'aaaaaaaa-1',
    qid: MAIN,
    displayOrder: 0,
    subType: 'text',
    response: [{ type: 'text', value: '<p>Hello _There_<br>second line</p>\n' }],
  }),
  node({
    nodeId: 'bbbbbbbb-2',
    qid: MAIN,
    displayOrder: 1,
    subType: 'name',
    input: true,
    input_type: 'NAME',
    variable: 'new_contact',
    property: { property: { label: 'New contact', value: 'new_contact' } },
    response: [{ type: 'text', value: 'Enter Name\n' }],
  }),
  node({
    nodeId: 'cccccccc-3',
    qid: MAIN,
    displayOrder: 2,
    subType: 'interactive-message',
    variable: 'main_menu',
    response: [
      {
        type: 'whatsapp_interactive',
        interactive: {
          type: 'button',
          body: 'Pick one\n\n',
          footer: 'Type "MM"- Main Menu',
          action: {
            buttons: [
              { type: 'flow', value: { text: 'education', nodeId: 'dddddddd-4', qid: EDU } },
              { type: 'flow', value: { text: 'elsewhere', nodeId: 'zzzzzzzz-9', qid: 'q-gone' } },
              { type: 'live_agent', value: { text: 'agent', nodeId: 'b2184' } },
            ],
          },
        },
      },
    ],
  }),
  node({
    nodeId: 'dddddddd-4',
    qid: EDU,
    displayOrder: 0,
    subType: 'interactive-message-list',
    variable: 'education',
    response: [
      {
        type: 'whatsapp_interactive_list',
        interactive: {
          type: 'list',
          body: 'Choose a course',
          action: {
            button: 'GII Courses',
            sections: [
              {
                title: 'GII Courses',
                rows: [
                  {
                    type: 'flow',
                    value: { text: 'Diploma In Germology', nodeId: 'eeeeeeee-5', qid: EDU },
                  },
                  {
                    type: 'flow',
                    value: { text: 'Back to menu', nodeId: 'cccccccc-3', qid: MAIN },
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  }),
  node({
    nodeId: 'eeeeeeee-5',
    qid: EDU,
    displayOrder: 1,
    subType: 'media',
    response: [
      { type: 'image', value: { text: 'Course photo', url: 'https://example.com/a.png' } },
    ],
  }),
  node({
    nodeId: 'ffffffff-6',
    qid: EDU,
    displayOrder: 2,
    subType: 'interactive-button-url',
    response: [
      {
        type: 'interactive-button-url',
        interactive: {
          type: 'button',
          body: 'Visit',
          action: {
            buttons: [{ type: 'link', value: { text: 'Maps', url: 'https://maps.example' } }],
          },
        },
      },
    ],
  }),
  node({ nodeId: 'gggggggg-7', qid: EDU, displayOrder: 3, subType: 'carousel', response: [] }),
];

describe('wabo export -> Simple', () => {
  it('recognises a wabo export, in a data wrapper or bare, and nothing else', () => {
    expect(isWaboExport(EXPORT)).toBe(true);
    expect(isWaboExport({ data: EXPORT, status: 200 })).toBe(true);
    expect(isWaboExport({ flowNodes: [], flowEdges: [] })).toBe(false);
    expect(isWaboExport('x')).toBe(false);
  });

  it('chains a qid by displayOrder, ends a chain at buttons / list, and links by nodeId', () => {
    const w = waboToGraph(EXPORT);
    const ids = w.graph.flowNodes.map((n) => n.id);
    expect(ids).toContain('n_aaaaaaaa');
    const out = (s: string, h: string) =>
      w.graph.flowEdges.find((e) => e.source === s && e.sourceHandle === h)?.target;
    expect(out('n_start000', 'out')).toBe('n_aaaaaaaa');
    expect(out('n_aaaaaaaa', 'out')).toBe('n_bbbbbbbb');
    expect(out('n_bbbbbbbb', 'out')).toBe('n_cccccccc');
    expect(out('n_cccccccc', 'out')).toBeUndefined(); // buttons end the chain
    expect(out('n_cccccccc', 'p0')).toBe('n_dddddddd');
    expect(out('n_cccccccc', 'p1')).toBeUndefined(); // another flow, not in the file
    expect(out('n_dddddddd', 'p0')).toBe('n_eeeeeeee');
    expect(out('n_dddddddd', 'p1')).toBe('n_cccccccc');
    expect(out('n_eeeeeeee', 'out')).toBe('n_ffffffff');
  });

  it('gives two nodes whose ids start alike two different steps', () => {
    const a = node({
      nodeId: '06de69db-0000-0000',
      qid: MAIN,
      displayOrder: 0,
      subType: 'text',
      response: [{ type: 'text', value: 'one' }],
    });
    const b = node({
      nodeId: '06de69db-1111-1111',
      qid: MAIN,
      displayOrder: 1,
      subType: 'text',
      response: [{ type: 'text', value: 'two' }],
    });
    const r = importToSimple([a, b]);
    if (!r.ok) throw new Error(r.reasons.join('; '));
    expect(r.doc.journeys[0]!.steps.map((s) => s.data.text)).toEqual(['one', 'two']);
    expect(new Set(r.doc.journeys[0]!.steps.map((s) => s.id)).size).toBe(2);
  });

  it('writes plain text, the console limits, the property link and the trigger words', () => {
    const w = waboToGraph(EXPORT);
    const by = (id: string) => w.graph.flowNodes.find((n) => n.id === id)!;
    expect(by('n_aaaaaaaa').data.text).toBe('Hello _There_\nsecond line');
    expect(by('n_bbbbbbbb').data).toMatchObject({
      validate: 'name',
      var: 'new_contact',
      saveProperty: true,
      propertyKey: 'new_contact',
    });
    expect(by('n_cccccccc').data).toMatchObject({
      options: ['education', 'elsewhere', 'agent'],
      var: 'main_menu',
    });
    expect(String(by('n_cccccccc').data.prompt)).toContain('Type "MM"- Main Menu');
    expect(by('n_dddddddd').data.options).toEqual([
      { title: 'Diploma In Germology', description: '', section: 'GII Courses' },
      { title: 'Back to menu', description: '', section: 'GII Courses' },
    ]);
    expect(w.keywords).toBe('hi');
    expect(w.notes.join('\n')).toMatch(/"live_agent" button/);
    expect(w.notes.join('\n')).toMatch(/not in this file/);
    expect(w.notes.join('\n')).toMatch(/Skipped a "carousel" step/);
  });

  it('opens as Simple flows named from the Intent records, with no step left unreached', () => {
    const r = importToSimple(EXPORT);
    if (!r.ok) throw new Error(r.reasons.join('; '));
    expect(r.source).toBe('wabo');
    // main: text, name, buttons. Education: the list ends its chain, then the photo and link button after it.
    expect(r.doc.journeys.map((j) => j.steps.length)).toEqual([3, 1, 2, 1]);
    // the Intent record names the main flow; a flow nothing names is called after the button that leads to it (every part of it)
    expect(r.doc.journeys.map((j) => j.name)).toEqual(['Hello', 'education', 'education', 'Hello']);
    // the list shows one entry per wabo flow, with all its steps
    expect(groupsOf(r.doc).map((g) => [g.name, g.steps])).toEqual([
      ['Hello', 4],
      ['education', 3],
    ]);
    expect(unreachable(r.doc)).toEqual([]);
    // it saves back to a graph the editor accepts
    const g = toGraph(r.doc);
    expect(g.flowNodes).toHaveLength(allSteps(r.doc).length + 1);
    // the live-agent button leads to an Assign step; it only needs a team chosen
    expect(problems(r.doc, { senderRequired: false }).map((p) => p.message)).toEqual([
      'Step 1.4: choose the team the conversation goes to.',
    ]);
  });

  it("keeps this flow's number and trigger words when an import replaces it", () => {
    const r = importToSimple(EXPORT);
    if (!r.ok) throw new Error('import failed');
    const cur = emptyDoc();
    cur.trigger.data.deviceId = 'dev-1';
    cur.trigger.data.keywords = 'price';
    const next = applyImport(cur, r.doc);
    expect(next.trigger.id).toBe(cur.trigger.id);
    expect(next.trigger.data).toMatchObject({ deviceId: 'dev-1', keywords: 'price' });
    expect(next.journeys).toBe(r.doc.journeys);
    const blank = emptyDoc();
    expect(applyImport(blank, r.doc).trigger.data.keywords).toBe('hi');
  });
});

describe("Simple import: this workspace's own file", () => {
  it('reads an exported flow that fits Simple, and refuses one that does not', () => {
    const r = importToSimple(EXPORT);
    if (!r.ok) throw new Error('import failed');
    const file = {
      _wadesk_flow_export: 1,
      name: 'Menu',
      flow_type: 'chat',
      flow_data: toGraph(r.doc),
    };
    const again = importToSimple(file);
    expect(again.ok && again.name).toBe('Menu');
    expect(again.ok && again.source).toBe('crm');

    const withWebhook = {
      flow_type: 'chat',
      flow_data: {
        flowNodes: [
          { id: 't', type: 'trigger', x: 0, y: 0, data: {}, isStart: true },
          { id: 'w', type: 'webhook', x: 0, y: 100, data: {} },
        ],
        flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'w' }],
        vars: [],
      },
    };
    const bad = importToSimple(withWebhook);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reasons[0]).toMatch(/Simple builder does not have/);
    expect(importToSimple({ hello: 1 }).ok).toBe(false);
    expect(importToSimple({ flow_type: 'call', flow_data: { flowNodes: [] } }).ok).toBe(false);
  });
});

describe('wabo export quirks (from a real console export)', () => {
  const text = (
    nodeId: string,
    qid: string,
    order: number,
    value: unknown,
    over: Record<string, unknown> = {},
  ) =>
    node({
      nodeId,
      qid,
      displayOrder: order,
      subType: 'text',
      response: [{ type: 'text', value }],
      ...over,
    });

  it('leaves the opt-in / opt-out messages out (the console does not list them), and reads a video held in a text step', () => {
    const r = importToSimple([
      {
        type: 'Intent',
        qid: 'i',
        query: 'hi',
        question: 'hi',
        journey: { qid: 'q1', name: 'Hello' },
      },
      text('aaaaaaaa-1', 'q1', 0, 'Hello'),
      text('bbbbbbbb-2', 'OPT-IN-678-466', 0, 'Opt in'),
      node({
        nodeId: 'cccccccc-3',
        qid: 'q1',
        displayOrder: 1,
        subType: 'text',
        response: [{ type: 'video', value: { text: 'Watch', url: 'https://x/v.mp4' } }],
      }),
    ]);
    if (!r.ok) throw new Error(r.reasons.join('; '));
    expect(r.notes.join('\n')).toMatch(/opt-in \/ opt-out/);
    expect(groupsOf(r.doc).map((g) => [g.name, g.steps])).toEqual([['Hello', 2]]);
    expect(allSteps(r.doc)[1]?.data).toMatchObject({
      kind: 'video',
      url: 'https://x/v.mp4',
      caption: 'Watch',
    });
  });

  it('exact mode writes live-agent buttons as Assign steps and "node to node" actions as wires', () => {
    const raw = [
      text('aaaaaaaa-1', 'q1', 0, 'One', {
        actions: [{ type: 'connect_node', nodeId: 'dddddddd-4' }],
      }),
      node({
        nodeId: 'bbbbbbbb-2',
        qid: 'q1',
        displayOrder: 1,
        subType: 'interactive-message',
        response: [
          {
            type: 'whatsapp_interactive',
            interactive: {
              type: 'button',
              body: 'Pick',
              action: {
                buttons: [
                  { id: 'btn11111-x', type: 'flow', value: { text: 'Go', nodeId: 'dddddddd-4' } },
                  {
                    id: 'btn22222-y',
                    type: 'live_agent',
                    value: { text: 'Agent', nodeId: 'b2184' },
                  },
                ],
              },
            },
          },
        ],
      }),
      text('dddddddd-4', 'q2', 0, 'Four'),
    ];
    const w = waboToGraph(raw, { exact: true });
    const edgeOf = (s: string, h: string) =>
      w.graph.flowEdges.find((e) => e.source === s && e.sourceHandle === h)?.target;
    expect(edgeOf('n_aaaaaaaa', 'out')).toBe('n_dddddddd'); // the action replaces "next in order"
    expect(edgeOf('n_bbbbbbbb', 'p0')).toBe('n_dddddddd');
    const agent = edgeOf('n_bbbbbbbb', 'p1')!;
    expect(w.graph.flowNodes.find((n) => n.id === agent)?.type).toBe('assign');
    expect(w.graph.flowNodes.find((n) => n.id === 'n_bbbbbbbb')?.data.options).toEqual([
      'Go',
      'Agent',
    ]);
    // the Simple import leaves both out and says so
    const simple = waboToGraph(raw);
    expect(simple.graph.flowNodes.some((n) => n.type === 'assign')).toBe(false);
    expect(simple.notes.join('\n')).toMatch(/"live_agent" button/);
  });

  it('reads a file question and a flow-list step', () => {
    const r = importToSimple([
      text('aaaaaaaa-1', 'q1', 0, 'Start'),
      node({
        nodeId: 'dddddddd-4',
        qid: 'q1',
        displayOrder: 1,
        subType: 'img-file',
        variable: 'upload',
        property: { property: { value: 'referrer_url' } },
        response: [
          { type: 'text', value: 'Send a file\n', allowedFileTypes: ['pdf', 'png', 'exe'] },
        ],
      }),
      node({
        nodeId: 'eeeeeeee-5',
        qid: 'q1',
        displayOrder: 2,
        subType: 'flow-list',
        response: [
          {
            type: 'whatsapp_interactive_list',
            interactive: {
              type: 'list',
              body: 'Pick',
              action: {
                button: 'Go',
                sections: [
                  {
                    title: 'S',
                    rows: [{ type: 'flow', value: { text: 'One', nodeId: 'aaaaaaaa-1' } }],
                  },
                ],
              },
            },
          },
        ],
      }),
    ]);
    if (!r.ok) throw new Error(r.reasons.join('; '));
    const steps = allSteps(r.doc);
    expect(steps.map((s) => s.type)).toEqual(['message', 'ask_file', 'list']);
    expect(steps[1]!.data).toMatchObject({
      var: 'upload',
      extensions: ['png', 'pdf'],
      saveProperty: true,
      propertyKey: 'referrer_url',
    });
    expect(steps[2]!.links).toEqual([steps[0]!.id]);
  });

  it('gives each flow its own name, and the trigger only the words of the flow it starts', () => {
    const r = importToSimple([
      {
        type: 'Intent',
        qid: 'i1',
        query: 'hi',
        question: 'hi',
        journey: { qid: 'q1', name: 'Hello' },
      },
      {
        type: 'FAQ',
        qid: 'f1',
        query: 'book a studio slot',
        question: 'Book a studio slot',
        journey: { qid: 'q2', name: 'Book a Slot' },
      },
      text('aaaaaaaa-1', 'q1', 0, 'Hello', { stage: '1.1' }),
      text('bbbbbbbb-2', 'q2', 0, 'Booking', { stage: '8.1' }),
      // two flows nothing names, both stage 1: they must not merge into one entry
      text('cccccccc-3', 'q3', 0, 'Three', { stage: '1.1' }),
      text('dddddddd-4', 'q4', 0, 'Four', { stage: '1.1' }),
    ]);
    if (!r.ok) throw new Error(r.reasons.join('; '));
    expect(r.doc.trigger.data.keywords).toBe('hi');
    const names = groupsOf(r.doc).map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(4);
    expect(names[0]).toBe('Hello');
  });
});
