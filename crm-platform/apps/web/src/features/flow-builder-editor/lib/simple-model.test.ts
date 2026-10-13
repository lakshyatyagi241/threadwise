import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowGraph, FlowNode } from '@crm/contracts';
import {
  stepKindsFor,
  addJourney,
  allSteps,
  duplicateGroup,
  duplicateStep,
  emptyDoc,
  groupsOf,
  insertStep,
  moveStep,
  newStep,
  optionCount,
  problems,
  removeGroup,
  removeJourney,
  renameGroup,
  STEP_KINDS,
  stageIn,
  stepLabel,
  removeStep,
  stageLabel,
  toGraph,
  toSimple,
  unreachable,
  updateStep,
  type SimpleDoc,
  type SimpleStep,
} from './simple-model';
import { translator } from '../test-utils/intl';
import { nodeLabelMsg } from './contract-text';
import { msg, renderMsg, type Msg } from './msg';

/** A message in English, as the user would read it. */
const en = (m: Msg): string => renderMsg(translator('flb'), m);

const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  x = 0,
  y = 0,
): FlowNode => ({
  id,
  type,
  x,
  y,
  data,
});
const edge = (source: string, sourceHandle: string, target: string): FlowEdge => ({
  id: `e_${source}_${sourceHandle}`,
  source,
  sourceHandle,
  target,
});
const graph = (flowNodes: FlowNode[], flowEdges: FlowEdge[]): FlowGraph => ({
  flowNodes,
  flowEdges,
  vars: [],
});

/** trigger -> welcome -> menu(buttons: Pricing -> price, Talk -> ends) ; price is the first step of a second journey */
const sample = (): FlowGraph =>
  graph(
    [
      node('t', 'trigger', { kind: 'keyword', keywords: 'hi' }),
      node('welcome', 'message', { text: 'Hello' }, 80, 250),
      node(
        'menu',
        'buttons',
        { prompt: 'Pick', options: ['Pricing', 'Talk'], var: 'choice_1' },
        80,
        440,
      ),
      node('price', 'message', { text: 'Our prices', journeyName: 'Pricing' }, 420, 60),
      node('thanks', 'message', { text: 'Bye' }, 420, 250),
    ],
    [
      edge('t', 'out', 'welcome'),
      edge('welcome', 'out', 'menu'),
      edge('menu', 'p0', 'price'),
      edge('price', 'out', 'thanks'),
    ],
  );

describe('graph to simple', () => {
  it('reads the trigger chain as the main journey and every other chain as its own journey', () => {
    const r = toSimple(sample());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.journeys.map((j) => j.steps.map((s) => s.id))).toEqual([
      ['welcome', 'menu'],
      ['price', 'thanks'],
    ]);
    expect(r.doc.journeys[1]!.name).toBe('Pricing');
    expect(r.doc.journeys[0]!.steps[1]!.links).toEqual(['price', null]);
  });

  it('writes the same graph back (round trip keeps ids, wires and button targets)', () => {
    const r = toSimple(sample());
    if (!r.ok) throw new Error('not simple');
    const g = toGraph(r.doc);
    const wires = g.flowEdges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}`).sort();
    expect(wires).toEqual(
      ['menu.p0>price', 'price.out>thanks', 't.out>welcome', 'welcome.out>menu'].sort(),
    );
    expect(g.flowNodes.find((n) => n.type === 'trigger')?.isStart).toBe(true);
    expect(g.flowNodes.find((n) => n.id === 'price')?.data.journeyName).toBe('Pricing');
    expect(g.flowNodes.find((n) => n.id === 'welcome')?.data.journeyName).toBeUndefined();
    expect(toSimple(g).ok).toBe(true);
  });

  it('refuses a graph the stack cannot show, with the reason', () => {
    const noTrigger = toSimple(graph([node('a', 'message')], []));
    expect(noTrigger.ok).toBe(false);
    const canvasOnly = toSimple(
      graph([node('t', 'trigger'), node('w', 'webhook')], [edge('t', 'out', 'w')]),
    );
    expect(canvasOnly).toEqual({
      ok: false,
      reasons: [msg('simpleModel.reasons.unsupportedStep', { node: nodeLabelMsg('webhook') })],
    });
    const merge = toSimple(
      graph(
        [node('t', 'trigger'), node('a', 'message'), node('b', 'message'), node('c', 'message')],
        [edge('t', 'out', 'a'), edge('t', 'out', 'b'), edge('a', 'out', 'c')],
      ),
    );
    expect(merge.ok).toBe(false);
    const loop = toSimple(
      graph(
        [node('t', 'trigger'), node('a', 'message'), node('b', 'message')],
        [edge('t', 'out', 'a'), edge('a', 'out', 'b'), edge('b', 'out', 'a')],
      ),
    );
    // a ring is a jump back: the last step carries on at the first
    expect(loop.ok && loop.doc.journeys[0]!.steps.map((x) => [x.id, x.goto ?? null])).toEqual([
      ['a', null],
      ['b', 'a'],
    ]);
  });

  it('reads a "node to node" wire as a jump, and writes it back', () => {
    const g = graph(
      [
        node('t', 'trigger'),
        node('a', 'message', { text: 'a' }),
        node('x', 'message', { text: 'x', journeyName: 'Other' }, 400, 0),
        node('y', 'message', { text: 'y', journeyName: 'Third' }, 800, 0),
        node('end', 'assign', { team: 't1', userId: '', message: '' }, 400, 300),
      ],
      [
        edge('t', 'out', 'a'),
        edge('a', 'out', 'end'),
        edge('x', 'out', 'end'),
        edge('y', 'out', 'end'),
      ],
    );
    const r = toSimple(g);
    if (!r.ok) throw new Error(r.reasons.map(en).join('; '));
    const steps = allSteps(r.doc);
    expect(steps.find((x) => x.id === 'a')!.goto).toBe('end');
    expect(steps.find((x) => x.id === 'x')!.goto).toBe('end');
    expect(steps.find((x) => x.id === 'end')!.type).toBe('assign');
    const back = toGraph(r.doc);
    expect(back.flowEdges.map((e) => `${e.source}>${e.target}`).sort()).toEqual(
      ['a>end', 't>a', 'x>end', 'y>end'].sort(),
    );
  });

  it('carries the jump to a step added at the end, and drops it when the target is removed', () => {
    const d = emptyDoc();
    const a = { ...newStep('message', []), id: 'a', data: { text: 'a' }, goto: 'far' };
    const far = { ...newStep('message', []), id: 'far', data: { text: 'far' } };
    d.journeys = [
      { name: 'Main flow', steps: [a] },
      { name: 'Far', steps: [far] },
    ];
    const added = insertStep(d, 0, 1, { ...newStep('message', [a]), id: 'b' });
    expect(added.journeys[0]!.steps.map((x) => [x.id, x.goto ?? null])).toEqual([
      ['a', null],
      ['b', 'far'],
    ]);
    expect(allSteps(removeStep(d, 'far'))[0]!.goto).toBeNull();
    expect(unreachable(d)).toEqual([]);
  });

  it('lets a button lead back to its own step (a menu that shows again)', () => {
    const g = graph(
      [node('t', 'trigger'), node('m', 'buttons', { prompt: 'p', options: ['again'], var: 'c' })],
      [edge('t', 'out', 'm'), edge('m', 'p0', 'm')],
    );
    const r = toSimple(g);
    expect(r.ok && r.doc.journeys[0]!.steps[0]!.links).toEqual(['m']);
  });
});

describe('editing a simple doc', () => {
  const base = (): SimpleDoc => {
    const d = emptyDoc();
    const a = newStep('message', []);
    const b = newStep('buttons', [a]);
    let doc = insertStep(d, 0, 0, a);
    doc = insertStep(doc, 0, 1, b);
    return doc;
  };

  it('a step cannot be added after a buttons / list step, and a buttons step has to be last', () => {
    const doc = base();
    const after = insertStep(doc, 0, 2, newStep('message', []));
    expect(allSteps(after)).toHaveLength(2);
    const before = insertStep(doc, 0, 0, newStep('list', []));
    expect(allSteps(before)).toHaveLength(2);
  });

  it('keeps one link per button when the buttons change', () => {
    const doc = base();
    const b = allSteps(doc)[1]!;
    const two = updateStep(doc, b.id, { data: { options: ['A', 'B', 'C'] } });
    expect(allSteps(two)[1]!.links).toHaveLength(3);
    const one = updateStep(two, b.id, { data: { options: ['A'] } });
    expect(allSteps(one)[1]!.links).toHaveLength(1);
  });

  it('removing a step ends the buttons that led to it, and removing a side journey drops it', () => {
    let doc = base();
    const target = newStep('message', allSteps(doc));
    doc = addJourney(doc, target);
    const b = allSteps(doc)[1]!;
    doc = updateStep(doc, b.id, { links: [target.id] });
    expect(allSteps(doc)[1]!.links).toEqual([target.id]);
    expect(allSteps(removeStep(doc, target.id))[1]!.links).toEqual([null]);
    expect(removeJourney(doc, 1).journeys).toHaveLength(1);
    expect(allSteps(removeJourney(doc, 1))[1]!.links).toEqual([null]);
  });

  it('moves a step up or down but never past the end buttons step; duplicates a plain step', () => {
    let doc = base();
    const [a, b] = allSteps(doc);
    expect(allSteps(moveStep(doc, a!.id, 1)).map((s) => s.id)).toEqual([a!.id, b!.id]);
    doc = insertStep(doc, 0, 1, newStep('delay', allSteps(doc)));
    const [x, d] = allSteps(doc);
    expect(allSteps(moveStep(doc, x!.id, 1)).map((s) => s.id)[0]).toBe(d!.id);
    const dup = duplicateStep(doc, x!.id);
    expect(allSteps(dup)).toHaveLength(4);
    expect(duplicateStep(doc, allSteps(doc).at(-1)!.id)).toBe(doc);
  });

  it('gives every new question and menu its own variable name', () => {
    const a = newStep('ask', []);
    const b = newStep('ask', [a]);
    const c = newStep('buttons', [a, b]);
    expect([a.data.var, b.data.var, c.data.var]).toEqual(['answer_1', 'answer_2', 'choice_1']);
  });
});

describe('checks', () => {
  it('numbers steps like the console: journey, dot, step', () => {
    expect(stageLabel(0, 0)).toBe('1.1');
    expect(stageLabel(1, 2)).toBe('2.3');
  });

  it('lists what is missing before a flow can be published', () => {
    const doc = emptyDoc();
    expect(problems(doc, { senderRequired: true }).map((p) => en(p.message))).toEqual([
      'The trigger needs at least one keyword (or choose any message).',
      'Pick the WhatsApp number this flow runs on.',
      'Add a first step: it is what the customer receives.',
    ]);
    let d2 = insertStep(doc, 0, 0, newStep('message', []));
    d2 = {
      ...d2,
      trigger: { ...d2.trigger, data: { ...d2.trigger.data, keywords: 'hi', deviceId: 'waba:1' } },
    };
    expect(problems(d2, { senderRequired: true }).map((p) => en(p.message))).toEqual([
      'Step 1.1: write the message.',
    ]);
  });

  it('flags long button labels and repeated variable names', () => {
    let d = emptyDoc();
    const b = newStep('buttons', []);
    d = insertStep(d, 0, 0, b);
    d = updateStep(d, b.id, { data: { prompt: 'p', options: ['x'.repeat(21)] } });
    d.trigger.data.keywords = 'hi';
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: a button label is longer than 20 characters.',
    ]);
    const a1 = newStep('ask', []);
    const a2 = {
      ...newStep('ask', []),
      data: { ...newStep('ask', []).data, var: a1.data.var, prompt: 'q' },
    };
    let e = emptyDoc();
    e.trigger.data.keywords = 'hi';
    e = insertStep(insertStep(e, 0, 0, { ...a1, data: { ...a1.data, prompt: 'q' } }), 0, 1, a2);
    expect(en(problems(e, { senderRequired: false })[0]!.message)).toContain(
      'is already used by step 1.1',
    );
  });

  it('finds a side journey nothing leads to', () => {
    let doc = emptyDoc();
    const s = newStep('message', []);
    doc = addJourney(doc, s);
    expect(unreachable(doc).map((x) => x.id)).toEqual([s.id]);
  });
});

describe('questions that check the answer', () => {
  it('a question made from a menu entry starts with its check and its own variable name', () => {
    const email = newStep('ask', [], 'email');
    expect(email.data).toMatchObject({ validate: 'email', var: 'email_1' });
    const second = newStep('ask', [email], 'email');
    expect(second.data.var).toBe('email_2');
    expect(newStep('ask', [], 'date').data).toMatchObject({ validate: 'date', var: 'date_1' });
    expect(newStep('ask', []).data.validate).toBe('text');
    expect(newStep('ask_file', []).data.var).toBe('file_1');
    expect(newStep('ask_location', []).data.var).toBe('location_1');
  });

  it('the card says what a question checks', () => {
    expect(en(stepLabel(newStep('ask', [], 'phone')))).toBe('Question · Phone number');
    expect(en(stepLabel(newStep('ask', [])))).toBe('Question');
    expect(en(stepLabel(newStep('message', [])))).toBe('Message');
  });

  it('the menu has an entry for every step type and one per question check', () => {
    const keys = STEP_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of ['message', 'media', 'buttons', 'list', 'ask_file', 'ask_location', 'delay']) {
      expect(
        STEP_KINDS.some((k) => k.type === t),
        t,
      ).toBe(true);
    }
    expect(STEP_KINDS.filter((k) => k.type === 'ask').map((k) => k.preset)).toEqual([
      'text',
      'name',
      'email',
      'phone',
      'number',
      'alphanumeric',
      'date',
    ]);
  });

  it('a file and a location question continue into the next step like a message does', () => {
    const g = graph(
      [
        node('t', 'trigger'),
        node('f', 'ask_file', { prompt: 'p', var: 'file' }),
        node('l', 'ask_location', { prompt: 'p', var: 'loc' }),
        node('m', 'message', { text: 'x' }),
      ],
      [edge('t', 'out', 'f'), edge('f', 'out', 'l'), edge('l', 'out', 'm')],
    );
    const r = toSimple(g);
    expect(r.ok && r.doc.journeys[0]!.steps.map((x) => x.type)).toEqual([
      'ask_file',
      'ask_location',
      'message',
    ]);
    expect(r.ok && toGraph(r.doc).flowEdges).toHaveLength(3);
  });

  it('an Ask with fixed answers or a file upload needs the canvas', () => {
    const withOptions = graph(
      [node('t', 'trigger'), node('a', 'ask', { prompt: 'p', var: 'a', options: ['yes', 'no'] })],
      [edge('t', 'out', 'a')],
    );
    expect(toSimple(withOptions)).toEqual({
      ok: false,
      reasons: [msg('simpleModel.reasons.askFixed')],
    });
    const withMedia = graph(
      [node('t', 'trigger'), node('a', 'ask', { prompt: 'p', var: 'a', acceptMedia: true })],
      [edge('t', 'out', 'a')],
    );
    expect(toSimple(withMedia).ok).toBe(false);
  });

  it('flags a question that copies to a contact property without choosing one, and reuses of a file variable', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const a: SimpleStep = {
      ...newStep('ask', [], 'email'),
      data: {
        ...newStep('ask', [], 'email').data,
        prompt: 'Email?',
        saveProperty: true,
        propertyKey: '',
      },
    };
    d = insertStep(d, 0, 0, a);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: choose the contact property the answer is copied to.',
    ]);
    const f: SimpleStep = {
      ...newStep('ask_file', [a]),
      data: { ...newStep('ask_file', [a]).data, var: a.data.var },
    };
    const d2 = insertStep(updateStep(d, a.id, { data: { saveProperty: false } }), 0, 1, f);
    expect(
      problems(d2, { senderRequired: false }).some((p) => en(p.message).includes('already used')),
    ).toBe(true);
  });
});

describe('the list of flows (groups)', () => {
  /** main: m1, buttons b (-> p1 in "Pricing", -> m2 in the same flow's second part); "Pricing": p1, p2; main part 2: m2 */
  const build = (): SimpleDoc => {
    const m1 = { ...newStep('message', []), id: 'm1' };
    const b = { ...newStep('buttons', [m1]), id: 'b' };
    const p1 = { ...newStep('message', [m1, b]), id: 'p1' };
    const p2 = { ...newStep('message', [m1, b, p1]), id: 'p2' };
    const m2 = { ...newStep('message', [m1, b, p1, p2]), id: 'm2' };
    b.links = ['p1', 'm2'];
    const doc = emptyDoc();
    doc.journeys = [
      { name: 'Hello', steps: [m1, b] },
      { name: 'Pricing', steps: [p1, p2] },
      { name: 'hello', steps: [m2] },
    ];
    return doc;
  };

  it('puts the chains that share a name in one entry, with all their steps counted', () => {
    const g = groupsOf(build());
    expect(g.map((x) => [x.name, x.chains, x.steps])).toEqual([
      ['Hello', [0, 2], 3],
      ['Pricing', [1], 2],
    ]);
  });

  it('numbers steps by the entry and their place across its parts', () => {
    const d = build();
    expect(stageIn(d, 0, 1)).toBe('1.2');
    expect(stageIn(d, 2, 0)).toBe('1.3'); // the second part of the first flow carries on the count
    expect(stageIn(d, 1, 1)).toBe('2.2');
  });

  it("keeps the main flow's name on the trigger and every other part's name on its first step", () => {
    const g = toGraph(build());
    expect(g.flowNodes.find((n) => n.type === 'trigger')?.data.journeyName).toBe('Hello');
    expect(g.flowNodes.find((n) => n.id === 'p1')?.data.journeyName).toBe('Pricing');
    expect(g.flowNodes.find((n) => n.id === 'm2')?.data.journeyName).toBe('hello');
    const back = toSimple(g);
    expect(back.ok && groupsOf(back.doc).map((x) => [x.name, x.steps])).toEqual([
      ['Hello', 3],
      ['Pricing', 2],
    ]);
    // a main flow called nothing special stores nothing
    const plain = emptyDoc();
    expect(toGraph(plain).flowNodes[0]!.data.journeyName).toBeUndefined();
  });

  it('renames, duplicates and deletes a whole entry', () => {
    const d = build();
    const renamed = renameGroup(d, 0, 'Welcome');
    expect(groupsOf(renamed).map((x) => x.name)).toEqual(['Welcome', 'Pricing']);

    const copy = duplicateGroup(d, 1);
    expect(groupsOf(copy.doc).map((x) => x.name)).toEqual(['Hello', 'Pricing', 'Pricing copy']);
    expect(copy.group).toBe(2);
    const ids = allSteps(copy.doc).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // the copy of the first flow keeps its buttons pointing inside the copy
    const hello = duplicateGroup(d, 0);
    const copied = hello.doc.journeys.filter((j) => j.name === 'Hello copy');
    expect(copied).toHaveLength(2);
    const copiedButtons = copied[0]!.steps[1]!;
    expect(copiedButtons.links[0]).toBe('p1'); // not part of the entry: unchanged
    expect(copiedButtons.links[1]).toBe(copied[1]!.steps[0]!.id);

    expect(removeGroup(d, 0)).toBe(d); // the flow the trigger starts stays
    const gone = removeGroup(d, 1);
    expect(groupsOf(gone).map((x) => x.name)).toEqual(['Hello']);
    expect(allSteps(gone).find((s) => s.id === 'b')!.links).toEqual([null, 'm2']);
  });

  it('flags a list or quick replies that copies the pick to a contact property without choosing one', () => {
    for (const type of ['buttons', 'list'] as const) {
      let d = emptyDoc();
      d.trigger.data.keywords = 'hi';
      const base = newStep(type, []);
      const step: SimpleStep = {
        ...base,
        data: { ...base.data, saveProperty: true, propertyKey: '' },
      };
      d = insertStep(d, 0, 0, step);
      const about = (doc: typeof d) =>
        problems(doc, { senderRequired: false })
          .map((p) => en(p.message))
          .filter((m) => m.includes('contact property'));
      expect(about(d)).toEqual([
        'Step 1.1: choose the contact property the picked option is copied to.',
      ]);
      expect(about(updateStep(d, step.id, { data: { propertyKey: 'plan' } }))).toEqual([]);
    }
  });
});

describe('steps per channel', () => {
  it('a website chat bot offers only what the widget can show', () => {
    const keys = stepKindsFor('web').map((k) => k.type);
    expect(new Set(keys)).toEqual(
      new Set([
        'message',
        'media',
        'buttons',
        'carousel',
        'condition',
        'ask',
        'ask_file',
        'delay',
        'cta',
      ]),
    );
  });

  it('a WhatsApp bot keeps every step except the website-only carousel', () => {
    expect(stepKindsFor('chat')).toEqual(STEP_KINDS.filter((k) => k.type !== 'carousel'));
  });
});

describe('the carousel step', () => {
  const two = (extra: Record<string, unknown> = {}) => ({
    text: 'Pick one',
    cards: [
      {
        image: '',
        title: 'Pune',
        text: 'Open',
        buttons: [
          { type: 'reply', label: 'Book Pune', value: '' },
          { type: 'url', label: 'Details', value: 'https://x.test' },
        ],
      },
      {
        image: '',
        title: 'Mumbai',
        text: '',
        buttons: [{ type: 'reply', label: 'Book Mumbai', value: '' }],
      },
    ],
    ...extra,
  });

  it('starts with one card and one reply, so one exit', () => {
    const s = newStep('carousel', []);
    expect(s.links).toEqual([null]);
    expect(optionCount(s)).toBe(1);
  });

  it('has one exit per reply button, in card order, not per card or per link button', () => {
    expect(optionCount({ type: 'carousel', data: two() })).toBe(2);
  });

  it('keeps its exits in step with the replies when buttons change', () => {
    let d = emptyDoc();
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    d = updateStep(d, c.id, { data: two() });
    expect(allSteps(d).find((x) => x.id === c.id)!.links).toHaveLength(2);
  });

  it('round-trips through the graph: each reply exit is wired to its own step', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    d = updateStep(d, c.id, { data: two() });
    const a = newStep('message', allSteps(d));
    d = addJourney(d, a);
    const b = newStep('message', allSteps(d));
    d = addJourney(d, b);
    d = updateStep(d, c.id, { links: [a.id, b.id] });
    const g = toGraph(d);
    expect(
      g.flowEdges.filter((e) => e.source === c.id).map((e) => [e.sourceHandle, e.target]),
    ).toEqual([
      ['p0', a.id],
      ['p1', b.id],
    ]);
  });

  it('asks for a card with a title, and for a name and an address on every button', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: add at least one card and give every card a title.',
    ]);
    d = updateStep(d, c.id, {
      data: {
        cards: [{ title: 'A', buttons: [{ type: 'url', label: 'Open', value: '' }] }],
      },
    });
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: give every button a name, and a link, number or address where it opens one.',
    ]);
  });
});

describe('the condition step', () => {
  it('has two exits, Yes then No, wired to the handles the runtime reads', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('condition', []);
    expect(c.links).toEqual([null, null]);
    expect(optionCount(c)).toBe(2);
    d = insertStep(d, 0, 0, c);
    const a = newStep('message', allSteps(d));
    d = addJourney(d, a);
    const b = newStep('message', allSteps(d));
    d = addJourney(d, b);
    d = updateStep(d, c.id, { links: [a.id, b.id] });
    const g = toGraph(d);
    expect(
      g.flowEdges.filter((e) => e.source === c.id).map((e) => [e.sourceHandle, e.target]),
    ).toEqual([
      ['yes', a.id],
      ['no', b.id],
    ]);
    // and back: a saved Yes/No condition opens with both exits wired
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (back.ok) expect(allSteps(back.doc).find((x) => x.id === c.id)!.links).toEqual([a.id, b.id]);
  });

  it('asks for complete rules, and takes nested AND / OR groups', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('condition', []);
    d = insertStep(d, 0, 0, c);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: finish the rules of the condition (a variable and a value in each).',
    ]);
    d = updateStep(d, c.id, {
      data: {
        conditionGroup: {
          op: 'or',
          items: [
            { variable: 'plan', operator: 'equals', value: 'pro' },
            { op: 'and', items: [{ variable: 'age', operator: 'greater_than', value: '30' }] },
          ],
        },
      },
    });
    expect(problems(d, { senderRequired: false })).toEqual([]);
  });
});

describe('a button that hands the visitor to a person', () => {
  it('counts as an exit of a carousel, and needs a team, but no step after it', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    d = updateStep(d, c.id, {
      data: {
        cards: [
          { title: 'Billing', buttons: [{ type: 'agent', label: 'Talk to billing', team: '' }] },
        ],
      },
    });
    expect(optionCount(allSteps(d)[0]!)).toBe(1);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: choose the team the conversation goes to.',
    ]);
    d = updateStep(d, c.id, {
      data: {
        cards: [
          {
            title: 'Billing',
            buttons: [{ type: 'agent', label: 'Talk to billing', team: 'team-1' }],
          },
        ],
      },
    });
    expect(problems(d, { senderRequired: false })).toEqual([]);
  });

  it('on a quick reply, is kept per button and needs a team', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const b = newStep('buttons', []);
    d = insertStep(d, 0, 0, b);
    d = updateStep(d, b.id, {
      data: {
        prompt: 'p',
        options: ['Pricing', 'Talk to a person'],
        handoffs: { '1': { team: '', message: '' } },
      },
    });
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: choose the team the conversation goes to.',
    ]);
    d = updateStep(d, b.id, {
      data: { handoffs: { '1': { team: 'team-1', message: 'Asked for a person' } } },
    });
    expect(problems(d, { senderRequired: false })).toEqual([]);
  });
});
