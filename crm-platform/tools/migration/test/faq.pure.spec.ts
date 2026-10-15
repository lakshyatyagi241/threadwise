import { describe, expect, it } from 'vitest';
import { FAQ_LIMITS, buildFaqDocs, type FaqDoc } from '../flows/faq';
import { STEP_DEPS, STEP_GROUPS } from '../load/steps';
import { REGISTRY } from '../registry';
import { STEPS, transformDoc } from '../transform';
import { faqKnowledge } from '../transform/faq';
import { Oid, type Doc } from '../util';
import type { Source } from '../extract/source';
import type { Ctx } from '../transform/types';
import { scanRawWrites } from '../pilot/staging/raw-writes';
import raw from '../pilot/staging/raw-writes.json';

const oid = (n: number): Oid => new Oid(n.toString(16).padStart(24, '0'));
const BOT = 'bot-1';
const rec = (n: number, extra: Doc = {}): Doc => ({
  _id: oid(n),
  botid: BOT,
  qid: `q${n}`,
  type: 'FAQ',
  question: `How do I pay ${n}?`,
  intent: `pay ${n}`,
  response: [{ type: 'text', value: '<p>Pay by card.</p><p>Or UPI.</p>' }],
  createdAt: new Date(Date.UTC(2026, 0, n)),
  updatedAt: new Date(Date.UTC(2026, 1, n)),
  ...extra,
});
const variations = (n: number, phrases: unknown, extra: Doc = {}): Doc => ({
  _id: oid(1000 + n),
  botid: BOT,
  qid: `q${n}`,
  phrases,
  ...extra,
});
const owns = () => ({ ok: true as const });
const build = (workspace: Doc[], vars: Doc[] = [], owner: Parameters<typeof buildFaqDocs>[0]['owner'] = owns): FaqDoc[] =>
  buildFaqDocs({ workspace, variations: vars, owner });

const ctxFor = (ok = true): Ctx =>
  ({
    client: 'acme',
    fallbackAt: '2026-06-01T00:00:00.000Z',
    ref: (c: string, k: unknown) =>
      ok && c === 'flow_bots' && k === BOT ? { id: 7, uuid: 'u', table: 'flows' } : undefined,
    flows: {
      bots: new Map([
        [BOT, { verdict: ok ? { kind: 'load' } : { kind: 'exclude', code: 'WEB_BOT_NO_FLOW', reason: 'web' } }],
      ]),
    },
  }) as unknown as Ctx;
const source = (c: Record<string, Doc[]>): Source =>
  ({
    collections: () => Object.keys(c),
    read: async function* (_client: string, name: string) {
      yield* c[name] ?? [];
    },
  }) as unknown as Source;
const stream = async (c: Record<string, Doc[]>, ctx = ctxFor()): Promise<Doc[]> => {
  const out: Doc[] = [];
  for await (const d of faqKnowledge.read!({ source: source(c), client: 'acme', idx: undefined as never, ctx }))
    out.push(d);
  return out;
};
const rowsOf = (d: FaqDoc, ctx = ctxFor()) => transformDoc(faqKnowledge, d as unknown as Doc, ctx);
const codeOf = (d: FaqDoc, ctx = ctxFor()): string => {
  const o = rowsOf(d, ctx);
  return o.kind === 'quarantine' ? o.code : o.kind;
};

describe('faq_knowledge wiring', () => {
  it('is a derived step after the flow steps; faq_variations still feeds faq_replies', () => {
    const names: string[] = STEPS.map((s) => s.handler);
    expect(names.indexOf('faq_knowledge')).toBeGreaterThan(names.indexOf('flow_bots'));
    expect(names).toContain('faq_replies');
    expect(STEP_DEPS.faq_knowledge).toEqual(['flow_bots']);
    expect(STEP_GROUPS.flows).toContain('faq_knowledge');
    expect(STEP_GROUPS.faq).toEqual(['faq_knowledge']);
    const e = REGISTRY.find((x) => x.collection === 'faq_variations')!;
    expect(e.handler).toBe('faq_replies');
    expect(e.targets).toEqual(expect.arrayContaining(['keyword_replies', 'faqs', 'faq_variations', 'faq_settings']));
    expect(faqKnowledge.virtual).toBe(true);
    expect(STEPS.filter((s) => s.mapCollection === faqKnowledge.mapCollection)).toHaveLength(1);
  });

  it('writes no vector column and names the settings table in raw-writes.json', () => {
    for (const t of Object.values(faqKnowledge.tables))
      for (const c of t.columns) expect(c.name).not.toMatch(/embed/);
    expect(scanRawWrites().sql.faq_settings).toEqual(raw.sql.faq_settings);
  });
});

describe('faq_knowledge documents', () => {
  it('an inline answer becomes a paused text FAQ with the question and the phrases as pending variations', () => {
    const [d] = build([rec(1)], [variations(1, ['can i pay by upi', 'how to pay', 'HOW do I pay 1?'])]);
    const out = rowsOf(d!);
    if (out.kind !== 'rows') throw new Error('rows expected');
    const faq = out.rows[0]!;
    expect(faq.table).toBe('faqs');
    expect(faq.row).toMatchObject({
      owner_flow_id: 7,
      question: 'How do I pay 1?',
      answer_type: 'text',
      answer_text: 'Pay by card.\n\nOr UPI.',
      flow_id: null,
      status: 'paused',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });
    const v = out.rows.slice(1);
    expect(v.every((r) => r.table === 'faq_variations')).toBe(true);
    expect(v.map((r) => [r.row.text, r.row.source])).toEqual([
      ['How do I pay 1?', 'question'],
      ['can i pay by upi', 'import'],
      ['how to pay', 'import'],
    ]); // the repeat of the question (any case) is not a second variation
    const cols = new Set(faqKnowledge.tables.faq_variations!.columns.map((c) => c.name));
    for (const r of v) for (const k of Object.keys(r.row)) expect(cols.has(k)).toBe(true);
    for (const k of Object.keys(faq.row))
      expect(faqKnowledge.tables.faqs!.columns.some((c) => c.name === k)).toBe(true);
  });

  it('without an inline answer the FAQ starts the flow of its bot (the journey cannot be addressed)', () => {
    const [d] = build([
      rec(2, { response: undefined, journey: { qid: 'j9', name: 'Pay', nodeId: 'n1' }, type: 'Intent' }),
    ]);
    const out = rowsOf(d!);
    if (out.kind !== 'rows') throw new Error('rows expected');
    expect(out.rows[0]!.row).toMatchObject({ answer_type: 'flow', answer_text: null, flow_id: 7, status: 'paused' });
    expect(out.soft?.map((s) => s.code)).toContain('QID_NOT_ADDRESSABLE');
  });

  it('the Intent records and the faq_variations of one journey are one FAQ', () => {
    const j = { qid: 'jq', name: 'Pay' };
    const docs = build(
      [
        rec(3, { qid: 'jq', type: 'Intent', response: undefined, journey: j, question: ['Pay now', 'Payment'] }),
        rec(4, { qid: 'jq', type: 'Intent', response: undefined, journey: j, question: 'Pay later' }),
      ],
      [variations(3, ['settle bill'], { qid: 'jq' })],
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]!.records).toBe(2);
    expect(docs[0]!.variations.map((v) => v.text)).toEqual(['Pay now', 'Payment', 'Pay later', 'settle bill']);
    expect(docs[0]!.soft.map((s) => s.code)).toEqual(
      expect.arrayContaining(['RECORDS_MERGED', 'QID_NOT_ADDRESSABLE']),
    );
  });

  it('a faq_variations qid that is the journey qid of a record joins that record', () => {
    const docs = build(
      [rec(5, { qid: 'own', response: undefined, journey: { qid: 'j5' } })],
      [variations(5, ['x y'], { qid: 'j5' })],
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]!.variations.map((v) => v.text)).toEqual(['How do I pay 5?', 'x y']);
  });

  it('quarantines, never guesses: no flow, no question, no answer, too long', () => {
    const off = () => ({ ok: false as const, code: 'BOT_INACTIVE', reason: 'off' });
    expect(codeOf(build([rec(1)], [], off)[0]!)).toBe('NO_OWNER_FLOW');
    expect(codeOf(build([rec(1)])[0]!, ctxFor(false))).toBe('NO_OWNER_FLOW');
    expect(codeOf(build([rec(1, { question: '  ', query: undefined })])[0]!)).toBe('NO_QUESTION');
    expect(codeOf(build([], [variations(1, ['only phrases'])])[0]!)).toBe('NO_QUESTION');
    expect(codeOf(build([rec(1, { response: [] })])[0]!)).toBe('NO_ANSWER');
    expect(codeOf(build([rec(1, { question: 'q'.repeat(501) })])[0]!)).toBe('QUESTION_TOO_LONG');
    expect(codeOf(build([rec(1, { response: [{ type: 'text', value: 'a'.repeat(4097) }] })])[0]!)).toBe(
      'ANSWER_TOO_LONG',
    );
    expect(codeOf(build([rec(1, { response: [{ type: 'text', value: 'a'.repeat(4096) }] })])[0]!)).toBe('rows');
  });

  it('trims what the application would refuse: long phrases dropped, repeats merged, 60 per FAQ', () => {
    const phrases = ['x'.repeat(501), '  Same  ', 'same', ...Array.from({ length: 80 }, (_, i) => `phrase ${i}`)];
    const [d] = build([rec(1)], [variations(1, phrases)]);
    expect(d!.variations).toHaveLength(FAQ_LIMITS.variationsPerFaq);
    expect(d!.variations[0]).toEqual({ text: 'How do I pay 1?', source: 'question' });
    expect(d!.variations.filter((v) => v.text.toLowerCase() === 'same')).toHaveLength(1);
    expect(d!.variations.every((v) => v.text.length <= FAQ_LIMITS.variation)).toBe(true);
    const soft = Object.fromEntries(d!.soft.map((s) => [s.code, s.detail]));
    expect(soft.VARIATION_TOO_LONG_DROPPED).toBe(1);
    // question + "same" + 80 phrases = 82 distinct, 60 kept
    expect(soft.VARIATIONS_CAPPED).toBe(82 - FAQ_LIMITS.variationsPerFaq);
  });

  it('a question used twice in one flow is numbered in load order, with a counted soft issue; the output is deterministic', () => {
    const ws = [rec(1, { question: 'Hours?' }), rec(2, { question: ' hours? ' }), rec(3, { question: 'HOURS?' })];
    const a = build(ws);
    expect(a.map((d) => d.question)).toEqual(['Hours?', 'hours? (2)', 'HOURS? (3)']);
    expect(a[1]!.soft.map((s) => s.code)).toContain('QUESTION_DUPLICATE_RENAMED');
    expect(a[1]!.variations.map((v) => [v.text, v.source])).toEqual([
      ['hours? (2)', 'question'],
      ['hours?', 'import'],
    ]);
    expect(JSON.stringify(build(ws))).toBe(JSON.stringify(a));
    // another flow may use the same question
    const other = build([rec(1, { question: 'Hours?' }), rec(2, { question: 'Hours?', botid: 'bot-2' })]);
    expect(other.map((d) => d.question)).toEqual(['Hours?', 'Hours?']);
  });

  it('a flow holds at most 500 FAQs: the rest is quarantined FAQ_LIMIT', () => {
    const ws = Array.from({ length: 502 }, (_, i) => rec(i + 1, { question: `Question number ${i}` }));
    const docs = build(ws);
    expect(docs.filter((d) => d.problem === null)).toHaveLength(FAQ_LIMITS.faqsPerFlow);
    expect(docs.slice(500).map((d) => d.problem?.code)).toEqual(['FAQ_LIMIT', 'FAQ_LIMIT']);
  });

  it('interactive answers keep their body, lose buttons (counted); a credential-looking value is redacted', () => {
    const [d] = build([
      rec(1, {
        response: [
          { type: 'interactive', interactive: { body: 'Pick one', action: { buttons: [{}, {}] } } },
          { type: 'text', value: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456' },
        ],
      }),
    ]);
    expect(d!.answer_text).toContain('Pick one');
    expect(d!.answer_text).not.toContain('abcdefghijklmnop');
    const soft = Object.fromEntries(d!.soft.map((s) => [s.code, s.detail]));
    expect(soft.ANSWER_PARTS_LOST).toMatchObject({ buttons: 2 });
    expect(soft.ANSWER_REDACTED).toBeGreaterThan(0);
  });

  it('every key of a derived document has a fields entry', async () => {
    const docs = await stream({ bot_workspace: [rec(1)], faq_variations: [variations(1, ['a'])] });
    expect(docs).toHaveLength(1);
    for (const k of Object.keys(docs[0]!)) expect(faqKnowledge.fields).toHaveProperty(k);
  });

  it('reads nothing without a flows plan, and is the same on every read', async () => {
    const c = { bot_workspace: [rec(1), rec(2)], faq_variations: [variations(1, ['a'])] };
    expect(await stream(c, { ...ctxFor(), flows: undefined } as Ctx)).toEqual([]);
    expect(JSON.stringify(await stream(c))).toBe(JSON.stringify(await stream(c)));
  });
});
