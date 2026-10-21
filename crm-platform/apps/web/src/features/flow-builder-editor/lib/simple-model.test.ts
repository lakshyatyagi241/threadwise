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
  stepSummary,
  stepText,
  removeStep,
  stageLabel,
  LINK_END,
  LINK_NEXT,
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
      graph([node('t', 'trigger'), node('w', 'book_appointment')], [edge('t', 'out', 'w')]),
    );
    expect(canvasOnly).toEqual({
      ok: false,
      reasons: [
        msg('simpleModel.reasons.unsupportedStep', { node: nodeLabelMsg('book_appointment') }),
      ],
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

  it('a step cannot follow a condition, and a condition has to be last; buttons / list may go anywhere', () => {
    let doc = insertStep(emptyDoc(), 0, 0, newStep('message', []));
    doc = insertStep(doc, 0, 1, newStep('condition', allSteps(doc)));
    expect(allSteps(insertStep(doc, 0, 2, newStep('message', [])))).toHaveLength(2);
    expect(allSteps(insertStep(doc, 0, 0, newStep('condition', [])))).toHaveLength(2);
    const before = insertStep(base(), 0, 0, newStep('list', []));
    expect(allSteps(before)).toHaveLength(3);
    expect(allSteps(before)[0]!.type).toBe('list');
  });

  it('a step added after buttons is what every button carries on with, and it round-trips', () => {
    const doc = base();
    const b = allSteps(doc)[1]!;
    const next = newStep('message', allSteps(doc));
    const after = insertStep(doc, 0, 2, next);
    expect(allSteps(after).map((s) => s.id)).toEqual([allSteps(doc)[0]!.id, b.id, next.id]);
    expect(allSteps(after)[1]!.links).toEqual([LINK_NEXT]);
    const graph = toGraph(after);
    expect(
      graph.flowEdges.some(
        (e) => e.source === b.id && e.sourceHandle === 'p0' && e.target === next.id,
      ),
    ).toBe(true);
    const back = toSimple(graph);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.doc.journeys).toHaveLength(1);
      expect(allSteps(back.doc).map((s) => s.id)).toEqual([allSteps(doc)[0]!.id, b.id, next.id]);
      expect(allSteps(back.doc)[1]!.links).toEqual([LINK_NEXT]);
      expect(allSteps(back.doc)[1]!.data.carryOn).toBeUndefined();
    }
  });

  it('a button set to end stays ended when a step follows, and removing the next step ends the rest', () => {
    const doc = base();
    const b = allSteps(doc)[1]!;
    const two = updateStep(doc, b.id, { data: { options: ['A', 'B'] } });
    const next = newStep('message', allSteps(two));
    let after = insertStep(two, 0, 2, next);
    after = updateStep(after, b.id, { links: [LINK_NEXT, null] });
    const graph = toGraph(after);
    expect(graph.flowEdges.filter((e) => e.source === b.id).map((e) => e.sourceHandle)).toEqual([
      'p0',
    ]);
    const back = toSimple(graph);
    expect(back.ok && allSteps(back.doc)[1]!.links).toEqual([LINK_NEXT, null]);
    expect(allSteps(removeStep(after, next.id))[1]!.links).toEqual([null, null]);
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
    expect(allSteps(moveStep(doc, a!.id, 1)).map((s) => s.id)).toEqual([b!.id, a!.id]);
    doc = insertStep(doc, 0, 1, newStep('delay', allSteps(doc)));
    const [x, d] = allSteps(doc);
    expect(allSteps(moveStep(doc, x!.id, 1)).map((s) => s.id)[0]).toBe(d!.id);
    const dup = duplicateStep(doc, x!.id);
    expect(allSteps(dup)).toHaveLength(4);
    const c = newStep('condition', allSteps(doc));
    const withCond = insertStep(doc, 0, 3, c);
    expect(duplicateStep(withCond, c.id)).toBe(withCond);
    expect(allSteps(moveStep(withCond, allSteps(withCond)[1]!.id, 1)).map((s) => s.id)[2]).not.toBe(
      c.id,
    );
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

  it('asks for a header file when the chosen template has a picture header with no file of its own', () => {
    const templates = [
      { name: 'promo', attachmentType: 'image', attachmentFile: 'meta-handle-123' },
      { name: 'sample', attachmentType: 'IMAGE', attachmentFile: 'https://cdn.example/a.png' },
      { name: 'plain', attachmentType: null, attachmentFile: null },
    ];
    const run = (data: Record<string, unknown>) => {
      let d = emptyDoc();
      d = insertStep(d, 0, 0, { ...newStep('template', []), data });
      d.trigger.data.keywords = 'hi';
      return problems(d, { senderRequired: false, templates }).map((p) => en(p.message));
    };
    expect(run({ tpl: 'promo' })).toEqual(["Step 1.1: add the template's header file."]);
    expect(run({ tpl: 'promo', tplMedia: 'https://a.b/c.png' })).toEqual([]);
    expect(run({ tpl: 'sample' })).toEqual([]);
    expect(run({ tpl: 'plain' })).toEqual([]);
  });

  it('flags a Location step until it has real coordinates, and keeps a saved one valid', () => {
    const run = (data: Record<string, unknown>) => {
      let d = emptyDoc();
      d = insertStep(d, 0, 0, { ...newStep('location', []), data });
      d.trigger.data.keywords = 'hi';
      return problems(d, { senderRequired: false }).map((p) => en(p.message));
    };
    const bad = ['Step 1.1: paste a Google Maps link or enter a valid latitude and longitude.'];
    expect(run({})).toEqual(bad);
    expect(run({ locMode: 'link', mapsUrl: '', lat: '', lng: '' })).toEqual(bad);
    expect(run({ lat: '0', lng: '0' })).toEqual(bad);
    expect(run({ lat: '91', lng: '10' })).toEqual(bad);
    expect(run({ lat: 'abc', lng: '10' })).toEqual(bad);
    // place name and address are optional; a step saved before the modes existed stays valid
    expect(run({ lat: '18.5204', lng: '73.8567', title: '', address: '' })).toEqual([]);
    expect(
      run({
        locMode: 'link',
        mapsUrl: 'https://maps.google.com/?q=1.5,2.5',
        lat: '1.5',
        lng: '2.5',
      }),
    ).toEqual([]);
  });

  it('a new Location step starts empty in link mode, with no placeholder name or address', () => {
    expect(newStep('location', []).data).toMatchObject({
      locMode: 'link',
      mapsUrl: '',
      lat: '',
      lng: '',
      title: '',
      address: '',
    });
  });

  it('flags long button labels and repeated variable names', () => {
    let d = emptyDoc();
    const b = newStep('buttons', []);
    d = insertStep(d, 0, 0, b);
    d = updateStep(d, b.id, { data: { prompt: 'p', options: ['x'.repeat(21)] } });
    const after = { ...newStep('message', allSteps(d)), data: { text: 'hi' } };
    d = updateStep(addJourney(d, after), b.id, { links: [after.id] });
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

  it('the menu has an entry for every step type and one Question (its answer type is chosen inside the step)', () => {
    const keys = STEP_KINDS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of ['message', 'media', 'buttons', 'list', 'ask_file', 'ask_location', 'delay']) {
      expect(
        STEP_KINDS.some((k) => k.type === t),
        t,
      ).toBe(true);
    }
    expect(STEP_KINDS.filter((k) => k.type === 'ask').map((k) => k.preset)).toEqual(['text']);
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

describe('the retired Answer from FAQ step in the Simple builder', () => {
  const faqGraph = () =>
    graph(
      [
        node('t', 'trigger'),
        node('f', 'faq', {
          query: '{{user_message}}',
          category: 'Billing',
          minScore: 0.6,
          sendAnswer: true,
          save: 'faq',
        }),
        node('yes', 'message', { text: 'Glad that helped', journeyName: 'Answered' }, 400, 0),
        node(
          'no',
          'assign',
          { team: 'support', userId: '', message: '', journeyName: 'Handoff' },
          800,
          0,
        ),
      ],
      [edge('t', 'out', 'f'), edge('f', 'matched', 'yes'), edge('f', 'no_match', 'no')],
    );

  it('is no longer a step of the menu, but an existing one still has its name on the card', () => {
    expect(STEP_KINDS.some((k) => k.type === 'faq')).toBe(false);
    expect(stepKindsFor('chat').some((k) => k.type === 'faq')).toBe(false);
    expect(en(stepLabel({ type: 'faq', data: {} }))).toBe('Answer from FAQ');
  });

  it('reads the two exits as two links and writes them back on the same ports', () => {
    const r = toSimple(faqGraph());
    if (!r.ok) throw new Error(r.reasons.map(en).join('; '));
    const step = allSteps(r.doc).find((s) => s.id === 'f')!;
    expect(step.type).toBe('faq');
    expect(step.links).toEqual(['yes', 'no']);
    expect(step.data).toMatchObject({ category: 'Billing', minScore: 0.6, save: 'faq' });
    const back = toGraph(r.doc);
    expect(back.flowEdges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}`).sort()).toEqual(
      ['f.matched>yes', 'f.no_match>no', 't.out>f'].sort(),
    );
    expect(toSimple(back).ok).toBe(true);
    expect(back.flowNodes.find((n) => n.id === 'f')!.data).toMatchObject({ minScore: 0.6 });
  });

  it('an exit that is not wired ends the conversation, and only that one', () => {
    const g = faqGraph();
    g.flowEdges = g.flowEdges.filter((e) => e.sourceHandle !== 'no_match');
    const r = toSimple(g);
    expect(r.ok && allSteps(r.doc).find((s) => s.id === 'f')!.links).toEqual(['yes', null]);
  });

  it('refuses a faq node wired from a port Simple has no place for, or from "out"', () => {
    const g = faqGraph();
    g.flowEdges.push(edge('f', 'out', 'yes'));
    const r = toSimple(g);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.reasons.map(en)).toEqual([
      expect.stringContaining('Answer from FAQ'),
    ]);
  });

  it('a new step has the catalogue defaults and one empty link per exit', () => {
    const s = newStep('faq', []);
    expect(s.data).toEqual({
      query: '{{user_message}}',
      category: '',
      minScore: null,
      sendAnswer: true,
      save: 'faq',
    });
    expect(s.links).toEqual([null, null]);
  });

  it('ends its part like buttons do: nothing can follow it, it can only be added and moved last, and it is not duplicated', () => {
    let d = emptyDoc();
    const m = newStep('message', []);
    d = insertStep(d, 0, 0, m);
    const f = newStep('faq', [m]);
    expect(insertStep(d, 0, 0, f)).toBe(d); // before another step: refused
    d = insertStep(d, 0, 1, f);
    expect(allSteps(d).map((s) => s.type)).toEqual(['message', 'faq']);
    const after = newStep('message', allSteps(d));
    expect(insertStep(d, 0, 2, after)).toBe(d); // after it: refused
    expect(moveStep(d, f.id, -1)).toBe(d); // moving it up would cut the message off
    expect(duplicateStep(d, f.id)).toBe(d);
  });

  it('keeps one link per exit when the step is edited, and drops a link whose target is removed', () => {
    let d = emptyDoc();
    const target = newStep('message', []);
    d = addJourney(d, target);
    const f = newStep('faq', []);
    d = insertStep(d, 0, 0, f);
    d = updateStep(d, f.id, { links: [target.id, null] });
    d = updateStep(d, f.id, { data: { category: 'Billing' } });
    expect(allSteps(d).find((s) => s.id === f.id)!.links).toEqual([target.id, null]);
    expect(allSteps(removeStep(d, target.id)).find((s) => s.id === f.id)!.links).toEqual([
      null,
      null,
    ]);
    // both exits leading into the other part count as reaching it
    d = updateStep(d, f.id, { links: [null, target.id] });
    expect(unreachable(d)).toEqual([]);
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
        'webhook',
        'ai',
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

  it('goes anywhere: a step may follow it, and a reply button can carry on with that step', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const first = newStep('message', []);
    d = insertStep(d, 0, 0, first);
    const c = newStep('carousel', allSteps(d));
    d = insertStep(d, 0, 1, c);
    d = updateStep(d, c.id, { data: two() });
    const after = newStep('message', allSteps(d));
    d = insertStep(d, 0, 2, after);
    // Inserted at the end after the carousel: every reply that led nowhere carries on with it.
    expect(allSteps(d).find((x) => x.id === c.id)!.links).toEqual([LINK_NEXT, LINK_NEXT]);
    const g = toGraph(d);
    expect(
      g.flowEdges.filter((e) => e.source === c.id).map((e) => [e.sourceHandle, e.target]),
    ).toEqual([
      ['p0', after.id],
      ['p1', after.id],
    ]);
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.doc.journeys[0]!.steps.map((x) => x.id)).toEqual([first.id, c.id, after.id]);
      expect(back.doc.journeys[0]!.steps[1]!.links).toEqual([LINK_NEXT, LINK_NEXT]);
    }
  });

  it('a carousel with only link buttons carries on by its next wire', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    d = updateStep(d, c.id, {
      data: {
        cards: [{ title: 'A', buttons: [{ type: 'url', label: 'Open', value: 'https://a.b' }] }],
      },
    });
    const after = newStep('message', allSteps(d));
    d = insertStep(d, 0, 1, after);
    const g = toGraph(d);
    expect(
      g.flowEdges.filter((e) => e.source === c.id).map((e) => [e.sourceHandle, e.target]),
    ).toEqual([['next', after.id]]);
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.doc.journeys[0]!.steps.map((x) => x.id)).toEqual([c.id, after.id]);
  });

  it('asks for a card with a title, and for a name and an address on every button', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: add at least one card and give every card a title.',
      'Step 1.1: the button "Choose" leads nowhere. Add a step for it, or give it an action.',
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
    const pricing = { ...newStep('message', allSteps(d)), data: { text: 'hi' } };
    d = updateStep(addJourney(d, pricing), b.id, { links: [pricing.id, null] });
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toEqual([
      'Step 1.1: choose the team the conversation goes to.',
    ]);
    d = updateStep(d, b.id, {
      data: { handoffs: { '1': { team: 'team-1', message: 'Asked for a person' } } },
    });
    expect(problems(d, { senderRequired: false })).toEqual([]);
  });
});

describe('API call and JS function steps (the Actions list)', () => {
  const docWith = (type: 'api_library' | 'code') => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const m = newStep('message', []);
    const a = newStep(type, [m]);
    const after = newStep('message', [m, a]);
    d = insertStep(d, 0, 0, m);
    d = insertStep(d, 0, 1, a);
    d = insertStep(d, 0, 2, after);
    return { d, a };
  };

  it('are offered in the + menu on WhatsApp and not on a website chat bot', () => {
    expect(stepKindsFor('chat').map((k) => k.key)).toEqual(
      expect.arrayContaining(['api-library', 'code']),
    );
    expect(stepKindsFor('web').map((k) => k.key)).not.toContain('api-library');
    expect(stepKindsFor('web').map((k) => k.key)).not.toContain('code');
  });

  it('start with their own result name, never one another step already saves', () => {
    const first = newStep('api_library', []);
    const second = newStep('api_library', [first]);
    expect(first.data.save).toBe('api_response_1');
    expect(second.data.save).toBe('api_response_2');
    expect(newStep('code', [first]).data.save).toBe('result_1');
  });

  it('say what is missing: an API to call, code to run', () => {
    const { d } = docWith('api_library');
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toContain(
      'Step 1.2: choose the API to call.',
    );
    const c = docWith('code');
    c.d = updateStep(c.d, c.a.id, { data: { code: '' } });
    expect(problems(c.d, { senderRequired: false }).map((p) => en(p.message))).toContain(
      'Step 1.2: write the code to run.',
    );
  });

  it('an API step carries on to the next step on success and on error, and reads back as a plain step', () => {
    const { d, a } = docWith('api_library');
    const g = toGraph(d);
    const from = g.flowEdges.filter((e) => e.source === a.id);
    expect(from.map((e) => e.sourceHandle).sort()).toEqual(['error', 'success']);
    expect(new Set(from.map((e) => e.target)).size).toBe(1);
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (back.ok)
      expect(back.doc.journeys[0]!.steps.map((s) => s.type)).toEqual([
        'message',
        'api_library',
        'message',
      ]);
  });

  it('an API step whose error ends the flow keeps doing so after a save from the Simple builder', () => {
    const { d, a } = docWith('api_library');
    const g = toGraph(d);
    g.flowEdges = g.flowEdges.filter((e) => !(e.source === a.id && e.sourceHandle === 'error'));
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = toGraph(back.doc);
    expect(again.flowEdges.filter((e) => e.source === a.id).map((e) => e.sourceHandle)).toEqual([
      'success',
    ]);
  });

  it('a graph whose API error wire goes elsewhere is left to the Advanced builder', () => {
    const { d, a } = docWith('api_library');
    const g = toGraph(d);
    const stray = g.flowEdges.find((e) => e.source === a.id && e.sourceHandle === 'error')!;
    stray.target = g.flowNodes[0]!.id;
    expect(toSimple(g).ok).toBe(false);
  });

  it('a JS function step is a plain step with one exit', () => {
    const { d, a } = docWith('code');
    const g = toGraph(d);
    expect(g.flowEdges.filter((e) => e.source === a.id).map((e) => e.sourceHandle)).toEqual([
      'out',
    ]);
    expect(toSimple(g).ok).toBe(true);
  });
});

describe('Webhook step and the Actions group', () => {
  it('Wait sits with the other actions (API call, Webhook, JS function), not under Send', () => {
    const group = (type: string) => STEP_KINDS.find((k) => k.type === type)?.group;
    for (const t of ['delay', 'api_library', 'webhook', 'code']) expect(group(t)).toBe('action');
  });

  it('Webhook is offered on WhatsApp and on the website chat, and saves its answer under its own name', () => {
    expect(stepKindsFor('chat').map((k) => k.type)).toContain('webhook');
    expect(stepKindsFor('web').map((k) => k.type)).toContain('webhook');
    const first = newStep('webhook', []);
    expect(first.data.save).toBe('webhook_response_1');
    expect(first.data.method).toBe('POST');
    expect(newStep('webhook', [first]).data.save).toBe('webhook_response_2');
  });

  it('says the address is missing, shows it on the card and reads back as a plain step', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const m = newStep('message', []);
    m.data.text = 'hello';
    const w = newStep('webhook', [m]);
    d = insertStep(d, 0, 0, m);
    d = insertStep(d, 0, 1, w);
    expect(problems(d, { senderRequired: false }).map((p) => en(p.message))).toContain(
      'Step 1.2: add the address (URL) to call.',
    );
    d = updateStep(d, w.id, { data: { url: 'https://api.example.com/stock' } });
    expect(problems(d, { senderRequired: false })).toEqual([]);
    const back = toSimple(toGraph(d));
    expect(back.ok).toBe(true);
    if (back.ok)
      expect(back.doc.journeys[0]!.steps.map((s) => s.type)).toEqual(['message', 'webhook']);
  });
});

describe('a button, row or reply that leads nowhere is not published', () => {
  const withStep = (type: 'buttons' | 'list', data: Record<string, unknown>) => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const b = newStep(type, []);
    d = insertStep(d, 0, 0, b);
    d = updateStep(d, b.id, { data });
    return { d, b };
  };
  const found = (d: ReturnType<typeof emptyDoc>) =>
    problems(d, { senderRequired: false }).map((p) => en(p.message));
  const buttons = { prompt: 'p', options: ['Yes', 'No'] };

  it('names each button with no step', () => {
    const { d, b } = withStep('buttons', buttons);
    const yes = { ...newStep('message', allSteps(d)), data: { text: 'hi' } };
    const wired = updateStep(addJourney(d, yes), b.id, { links: [yes.id, null] });
    expect(found(d)).toEqual([
      'Step 1.1: the button "Yes" leads nowhere. Add a step for it, or give it an action.',
      'Step 1.1: the button "No" leads nowhere. Add a step for it, or give it an action.',
    ]);
    expect(found(wired)).toEqual([
      'Step 1.1: the button "No" leads nowhere. Add a step for it, or give it an action.',
    ]);
  });

  it('accepts "ends here" when the author chose it, and keeps the choice through the graph', () => {
    const { d, b } = withStep('buttons', buttons);
    const ended = updateStep(d, b.id, { links: [LINK_END, LINK_END] });
    expect(found(ended)).toEqual([]);
    const g = toGraph(ended);
    expect(g.flowEdges.filter((e) => e.source === b.id)).toEqual([]);
    const back = toSimple({ flowNodes: g.flowNodes, flowEdges: g.flowEdges, vars: g.vars });
    expect(back.ok && allSteps(back.doc)[0]!.links).toEqual([LINK_END, LINK_END]);
    expect(back.ok && found(back.doc)).toEqual([]);
    // the same graph without the choice is an undecided button again
    const bare = toSimple({
      flowNodes: g.flowNodes.map((n) => {
        const { endOptions: _drop, ...data } = n.data as Record<string, unknown>;
        return { ...n, data };
      }),
      flowEdges: g.flowEdges,
      vars: g.vars,
    });
    expect(bare.ok && found(bare.doc)).toHaveLength(2);
  });

  it('says "row" for a list, and falls back to the position for a nameless one', () => {
    const { d } = withStep('list', {
      prompt: 'p',
      button: 'Pick',
      options: [{ title: 'Pricing', description: '', section: '' }],
    });
    expect(found(d)).toEqual([
      'Step 1.1: the row "Pricing" leads nowhere. Add a step for it, or give it an action.',
    ]);
    const { d: e } = withStep('buttons', { prompt: 'p', options: [' '] });
    expect(found(e)).toContain('Step 1.1: every button needs a label.');
    expect(found(e)).toContain(
      'Step 1.1: the button "#1" leads nowhere. Add a step for it, or give it an action.',
    );
  });

  it('accepts "carry on" only when a step follows, and an action as a way out', () => {
    const { d, b } = withStep('buttons', buttons);
    const carry = updateStep(d, b.id, { links: [LINK_NEXT, LINK_NEXT] });
    expect(found(carry)).toHaveLength(2);
    const next = newStep('message', allSteps(carry));
    const withNext = insertStep(carry, 0, 1, { ...next, data: { text: 'hi' } });
    expect(found(withNext)).toEqual([]);
    const acted = updateStep(d, b.id, {
      data: {
        handoffs: { '0': { team: 'team-1', message: '' } },
        optionActions: { '1': { type: 'opt_out' } },
      },
    });
    expect(found(acted)).toEqual([]);
    const flowAction = updateStep(d, b.id, {
      data: { optionActions: { '0': { type: 'flow', flow: 'f-1' }, '1': { type: 'opt_in' } } },
    });
    expect(found(flowAction)).toEqual([]);
  });

  it('checks the reply buttons of a carousel, not its link buttons, and counts a person as a way out', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const c = newStep('carousel', []);
    d = insertStep(d, 0, 0, c);
    d = updateStep(d, c.id, {
      data: {
        cards: [
          {
            title: 'A',
            buttons: [
              { type: 'url', label: 'Open', value: 'https://example.com' },
              { type: 'reply', label: 'Pick me' },
              { type: 'agent', label: 'Talk', team: 'team-1' },
            ],
          },
        ],
      },
    });
    expect(found(d)).toEqual([
      'Step 1.1: the button "Pick me" leads nowhere. Add a step for it, or give it an action.',
    ]);
  });

  it('leaves an open condition or FAQ exit alone: nobody taps it', () => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const f = newStep('faq', []);
    d = insertStep(d, 0, 0, f);
    expect(found(d)).toEqual([]);
  });

  it('refuses more buttons or rows than WhatsApp allows', () => {
    const { d, b } = withStep('buttons', { prompt: 'p', options: ['a', 'b', 'c', 'd'] });
    const wired = updateStep(d, b.id, { links: [LINK_NEXT, LINK_NEXT, LINK_NEXT, LINK_NEXT] });
    const next = insertStep(wired, 0, 1, { ...newStep('message', []), data: { text: 'x' } });
    expect(found(next)).toEqual(['Step 1.1: a set of buttons can have at most 3 buttons.']);
  });
});

describe('the AI assistant step: an agent, or a custom setup with a prompt', () => {
  const docWithAi = (data: Record<string, unknown>) => {
    let d = emptyDoc();
    d.trigger.data.keywords = 'hi';
    const m = newStep('message', []);
    const a = newStep('ai', [m]);
    d = insertStep(d, 0, 0, m);
    d = insertStep(d, 0, 1, a);
    d = updateStep(d, a.id, { data });
    return { d, a };
  };
  const ask = (d: SimpleDoc) =>
    problems(d, { senderRequired: false })
      .map((p) => en(p.message))
      .filter((m) => m.includes('AI'));

  it('a new step starts as an agent setup and cannot be published until an agent is chosen', () => {
    const a = newStep('ai', []);
    expect(a.data.agentMode).toBe('agent');
    expect(a.data.assistant).toBe('');
    const { d } = docWithAi({ ...a.data });
    expect(ask(d)).toEqual([
      'Step 1.2: choose the AI agent that answers, or switch the step to a custom setup.',
    ]);
  });

  it('an agent setup passes once an agent is chosen, whatever the prompt field holds', () => {
    expect(ask(docWithAi({ agentMode: 'agent', assistant: 'a-1', prompt: '' }).d)).toEqual([]);
  });

  it('a custom setup needs a prompt, unless an agent lends its knowledge (a step saved that way before)', () => {
    expect(ask(docWithAi({ agentMode: 'custom', prompt: '  ', assistant: '' }).d)).toEqual([
      'Step 1.2: write the instructions for the AI, or choose an AI agent.',
    ]);
    expect(ask(docWithAi({ agentMode: 'custom', prompt: 'Be brief', assistant: '' }).d)).toEqual(
      [],
    );
    expect(ask(docWithAi({ agentMode: 'custom', prompt: '', assistant: 'a-1' }).d)).toEqual([]);
  });

  it('a step saved before the choice existed has no mode, keeps working and keeps its fields', () => {
    const old = {
      model: 'gpt-4o-mini',
      prompt: 'Answer about farms',
      assistant: 'a-1',
      save: 'reply',
    };
    const g = graph(
      [node('t', 'trigger', { kind: 'keyword', keywords: 'hi' }), node('ai1', 'ai', old, 80, 250)],
      [edge('t', 'out', 'ai1')],
    );
    const back = toSimple(g);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(ask(back.doc)).toEqual([]);
    const s = allSteps(back.doc).find((x) => x.id === 'ai1')!;
    expect(s.data).toMatchObject(old);
    expect(s.data.agentMode).toBeUndefined();
    const saved = toGraph(back.doc).flowNodes.find((n) => n.id === 'ai1')!;
    expect(saved.data).toMatchObject(old);
    expect(saved.data.agentMode).toBeUndefined();
  });
});

describe('the Human handoff returned exit in the Simple builder (Return to bot)', () => {
  const handoffGraph = () =>
    graph(
      [
        node('t', 'trigger'),
        node('h', 'assign', { handoff: 2, destination: 'rules', returnMessage: 'I am back' }),
        node('m', 'message', { text: 'Welcome back', journeyName: 'After' }, 400, 0),
      ],
      [edge('t', 'out', 'h'), edge('h', 'returned', 'm')],
    );

  it('reads the wire as the step the chat returns to and writes the same wire back', () => {
    const r = toSimple(handoffGraph());
    if (!r.ok) throw new Error(r.reasons.map(en).join('; '));
    const step = allSteps(r.doc).find((s) => s.id === 'h')!;
    expect(step.data.returnTo).toBe('m');
    expect(step.data.returnMessage).toBe('I am back');
    // the target is reached through the returned exit, so it is not reported as a step nothing leads to
    expect(unreachable(r.doc).map((s) => s.id)).toEqual([]);
    const back = toGraph(r.doc);
    expect(back.flowEdges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}`).sort()).toEqual(
      ['h.returned>m', 't.out>h'].sort(),
    );
    // returnTo is not stored on the node: the wire is the only copy
    expect(back.flowNodes.find((n) => n.id === 'h')!.data.returnTo).toBeUndefined();
    expect(toSimple(back).ok).toBe(true);
  });

  it('writes no wire for an empty choice, for the step itself, or for a step that is gone', () => {
    const r = toSimple(handoffGraph());
    if (!r.ok) throw new Error('not simple');
    const h = allSteps(r.doc).find((s) => s.id === 'h')!;
    for (const to of ['', 'h', 'gone']) {
      h.data.returnTo = to;
      expect(toGraph(r.doc).flowEdges.some((e) => e.sourceHandle === 'returned')).toBe(false);
    }
  });

  it('the other exits of a handoff are still not Simple (they need the Advanced canvas)', () => {
    const g = handoffGraph();
    g.flowEdges.push(edge('h', 'waiting', 'm'));
    expect(toSimple(g)).toMatchObject({ ok: false });
  });
});

describe('the closed step card text', () => {
  const withText = (type: 'message' | 'ask', data: Record<string, unknown>) => ({
    ...newStep(type, []),
    data,
  });

  it('keeps the marks and every line break for the message box to draw', () => {
    expect(stepText(withText('message', { text: '*Welcome*\n\nHello _there_' }))).toBe(
      '*Welcome*\n\nHello _there_',
    );
    expect(stepText(withText('ask', { prompt: '_Your name?_' }))).toBe('_Your name?_');
  });

  it('gives no text for a step that sends none of its own', () => {
    expect(stepText(withText('ask', {}))).toBe('');
    expect(stepText({ ...newStep('webhook', []), data: { url: 'https://x.test/a_b_c' } })).toBe('');
  });

  it('keeps the one-line summary: lines joined, cut at 40 characters', () => {
    const s = withText('message', { text: '*Welcome to campaigns for geta.ai* _Hello\nthere_' });
    expect(stepSummary(s, (key) => key)).toBe('*Welcome to campaigns for geta.ai* _Hell…');
  });
});
