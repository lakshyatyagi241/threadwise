import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLB_ASK_INPUT_TYPES,
  FLB_DATE_FORMATS,
  FLB_NODE_GROUPS,
  FLB_NODE_TYPE_LIST,
  FLB_ASK_INPUT_LABELS,
  FLB_TRIGGER_KINDS,
  FLB_TRIGGER_PORT_LABELS,
  FLOW_TYPE_LABELS,
  FLOW_TYPES,
  flbAskInputWrongText,
  flbCondSummary,
  flbPortsFor,
  flbValidateGraph,
  type FlbCondGroup,
} from '@crm/contracts';
import { enMessages, translator } from '../test-utils/intl';
import {
  askInputLabel,
  askInputWrongText,
  condSummary,
  dateFormatLabel,
  flowTypeLabel,
  groupLabel,
  listOption,
  nodeDescription,
  nodeLabel,
  portLabel,
} from './contract-text';
import { renderMsg } from './msg';
import { validateGraph } from './validation-text';

const t = translator('flb');
const flb = (enMessages as unknown as { flb: Record<string, unknown> }).flb;
const has = (key: string): boolean => {
  let cur: unknown = flb;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string';
};

describe("the contracts' English, looked up by id, reads the same in English", () => {
  it('every node type has its name, description and group in the catalogue', () => {
    for (const d of FLB_NODE_TYPE_LIST) {
      expect(nodeLabel(t, d.id), d.id).toBe(d.label);
      expect(nodeDescription(t, d.id), d.id).toBe(d.desc);
      expect(has(`contracts.nodeTypes.${d.id}.label`), d.id).toBe(true);
      expect(has(`contracts.nodeTypes.${d.id}.description`), d.id).toBe(true);
    }
    for (const g of FLB_NODE_GROUPS) expect(groupLabel(t, g)).toBe(g);
    expect(has('contracts.groups.callRouting')).toBe(true);
  });

  it('input kinds, wrong-answer texts, channels and date shapes', () => {
    for (const k of FLB_ASK_INPUT_TYPES) {
      expect(askInputLabel(t, k)).toBe(FLB_ASK_INPUT_LABELS[k]);
      expect(askInputWrongText(t, k, 'dd/mm/yy')).toBe(flbAskInputWrongText(k, 'dd/mm/yy'));
    }
    for (const f of FLB_DATE_FORMATS) expect(dateFormatLabel(t, f)).toBe(f.toUpperCase());
    for (const f of FLOW_TYPES) expect(flowTypeLabel(t, f)).toBe(FLOW_TYPE_LABELS[f]);
  });

  it("every port label of every node, and the trigger's", () => {
    const samples: Array<Record<string, unknown>> = [
      {},
      { options: ['a', 'b'] },
      { options: [{ title: 'Row' }, {}] },
      { options: [{ match: 'x' }, {}] },
      { wait: true, mode: 'read', action: 'move' },
    ];
    for (const d of FLB_NODE_TYPE_LIST) {
      for (const data of samples) {
        const node = { type: d.id, data };
        for (const p of flbPortsFor(node, {
          templateButtons: () => [{ label: 'Yes' }, { label: '' }],
        })) {
          expect(portLabel(t, node, p), `${d.id} ${p.id}`).toBe(p.label);
        }
      }
    }
    for (const kind of FLB_TRIGGER_KINDS) {
      const node = { type: 'trigger', data: { kind } };
      const [p] = flbPortsFor(node);
      expect(portLabel(t, node, p!)).toBe(FLB_TRIGGER_PORT_LABELS[kind] ?? kind);
    }
    expect(portLabel(t, { type: 'trigger', data: {} }, { id: 'out', label: 'manual' })).toBe(
      'manual',
    );
    // The author's own words are kept as written.
    expect(portLabel(t, { type: 'buttons' }, { id: 'p0', label: 'Talk to sales' })).toBe(
      'Talk to sales',
    );
  });

  it("a condition reads the same as the contracts' one-liner", () => {
    const rule = (variable: string, operator: string, value = '') => ({
      variable,
      operator,
      value,
    });
    const tree: FlbCondGroup = {
      op: 'or',
      items: [
        rule('a', 'equals', 'x'),
        { op: 'and', items: [rule('b', 'gt', '3'), rule('c', 'exists'), rule('', 'contains', '')] },
        { op: 'and', items: [] },
      ],
    };
    expect(condSummary(t, tree)).toBe(flbCondSummary(tree));
  });

  it('an untitled list row is named from the catalogue', () => {
    expect(listOption(t, {}, 1).title).toBe('Item 2');
    expect(listOption(t, { title: 'Mine' }, 1).title).toBe('Mine');
    expect(listOption(t, 'plain', 0).title).toBe('plain');
  });
});

describe('the pre-save check lists the same problems as the contracts, in the catalogue', () => {
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    ...extra,
  });
  const cases: Array<[string, Parameters<typeof validateGraph>]> = [
    ['empty', [[], [], { mode: 'chat', senderAvailable: true }]],
    [
      'unconnected and wrong channel',
      [
        [
          node('t', 'trigger', { data: {} }),
          node('a', 'message'),
          node('b', 'ig_buttons'),
          node('c', 'list'),
        ],
        [{ source: 'b', target: 'c' }],
        { mode: 'facebook', senderAvailable: true },
      ],
    ],
    [
      'no sender on instagram',
      [[node('t', 'trigger', { data: {} })], [], { mode: 'instagram', senderAvailable: true }],
    ],
    [
      'no sender on chat, call-only node',
      [
        [node('t', 'trigger', { data: {} }), node('s', 'cf_say')],
        [{ source: 't', target: 's' }],
        { mode: 'chat', senderAvailable: true },
      ],
    ],
    [
      'AI assistant with no agent and no prompt',
      [
        [
          node('t', 'trigger', { data: { deviceId: 'd' } }),
          node('a', 'ai', { data: { agentMode: 'agent', assistant: '' } }),
          node('b', 'ai', { data: { agentMode: 'custom', prompt: '  ' } }),
          node('c', 'ai', { data: { agentMode: 'agent', assistant: 'x' } }),
          node('d', 'ai', { data: { prompt: 'Be brief' } }),
        ],
        [
          { source: 't', target: 'a' },
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
          { source: 'c', target: 'd' },
        ],
        { mode: 'chat', senderAvailable: true },
      ],
    ],
    [
      'no sender but none to pick',
      [[node('t', 'trigger', { data: {} })], [], { mode: 'call', senderAvailable: false }],
    ],
  ];
  for (const [name, args] of cases) {
    it(name, () => {
      const want = flbValidateGraph(...args);
      const got = validateGraph(...args);
      expect(got.ok).toBe(want.ok);
      expect(got.badNodeIds).toEqual(want.badNodeIds);
      expect(got.items.map((m) => renderMsg(t, m))).toEqual(want.items);
    });
  }
});

describe('every key the code names exists in the English catalogue', () => {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
    }
  };
  walk(root);

  it('msg("...") keys', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bmsg\(\s*'([\w.]+)'/g))
        if (!has(m[1]!)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('simulator tx("...") keys', () => {
    const src = readFileSync(join(root, 'builder/simulator/simulator.ts'), 'utf8');
    const keys = new Set<string>();
    for (const m of src.matchAll(/\btx\(\s*'(\w+)'/g)) keys.add(m[1]!);
    for (const k of [
      'ifYes',
      'ifNo',
      'httpOk',
      'httpNon2xx',
      'tagAdd',
      'tagRemove',
      'assigned',
      'assignedUser',
      'dealMove',
      'dealCreate',
      'userFile',
      'userFileCaption',
      'location',
      'locationCoords',
      'noPath',
      'noPathPort',
      'slot1',
      'slot5',
    ])
      keys.add(k);
    const missing = [...keys].filter((k) => !has(`simulator.${k}`));
    expect(missing).toEqual([]);
  });

  it('step kinds, type labels, problems and notes', () => {
    const src = readFileSync(join(root, 'lib/simple-model.ts'), 'utf8');
    for (const m of src.matchAll(/\bbad\(\s*'(\w+)'/g))
      expect(has(`simpleModel.problems.${m[1]}`), m[1]).toBe(true);
    expect(has('simpleModel.stepLabel.questionOf')).toBe(true);
  });
});
