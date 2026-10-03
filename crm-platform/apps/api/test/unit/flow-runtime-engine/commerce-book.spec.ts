import { describe, expect, it } from 'vitest';
import {
  checkAnswer,
  confirmationText,
  decodeChoice,
  questionPrompt,
  shown,
  slugOf,
  type BookContext,
  type BookQuestion,
  type Choice,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/book-rules';
import { shapeCommerceNode } from '../../../src/modules/flow-runtime-engine/graph/commerce-shapes';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';

const reply = (id: string, text: string) => ({ kind: 'tap' as const, id, text });
const rows: Choice[] = [
  { id: 'bk_day_0', title: 'Mon, 3 Nov' },
  { id: 'bk_day_1', title: 'Tue, 4 Nov' },
  { id: 'bk_more', title: 'More days ▸', special: true, more: 'day' },
];

describe('choosing from what was offered (WD-FLR-040)', () => {
  it('matches the row id, then the label or its cut form, then a typed number over the rows shown', () => {
    expect(decodeChoice(reply('bk_day_1', 'x'), rows)?.id).toBe('bk_day_1');
    expect(decodeChoice(reply('', 'Mon, 3 Nov'), rows)?.id).toBe('bk_day_0');
    expect(decodeChoice(reply('', 'Tue, 4'), rows)?.id).toBe('bk_day_1');
    expect(decodeChoice(reply('', '2'), rows)?.id).toBe('bk_day_1');
    expect(decodeChoice(reply('', '3'), rows)?.id).toBe('bk_more');
    expect(decodeChoice(reply('', '9'), rows)).toBeNull();
    expect(decodeChoice(reply('', 'banana'), rows)).toBeNull();
  });

  it('offers no more than a channel lists', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `t${i}` }));
    expect(shown(many)).toHaveLength(10);
  });
});

describe('the booking questions', () => {
  const q = (over: Partial<BookQuestion> = {}): BookQuestion => ({
    id: 'q1',
    label: 'Company',
    type: 'text',
    required: true,
    options: null,
    mapToContactField: null,
    ...over,
  });

  it('a required answer cannot be blank, an optional one can be skipped', () => {
    expect(checkAnswer(q(), '  ')).toEqual({ ok: false, say: 'Please answer: Company' });
    expect(checkAnswer(q({ required: false }), 'skip')).toEqual({ ok: true, value: '' });
    // WaDesk read "skip" to a required question as the answer itself.
    expect(checkAnswer(q(), 'skip')).toEqual({ ok: true, value: 'skip' });
  });

  it('a select takes its number or its text; an email is checked', () => {
    const sel = q({ type: 'select', options: ['Gold', 'Silver'] });
    expect(checkAnswer(sel, '2')).toEqual({ ok: true, value: 'Silver' });
    expect(checkAnswer(sel, 'gold')).toEqual({ ok: true, value: 'Gold' });
    expect(checkAnswer(q({ type: 'email' }), 'nope').ok).toBe(false);
    expect(checkAnswer(q({ type: 'email' }), 'a@b.co')).toEqual({ ok: true, value: 'a@b.co' });
  });

  it('asks with the intro first, marks optional ones, numbers the options', () => {
    const ctx = {
      qIndex: 0,
      introMessage: 'A few questions',
      questions: [q({ required: false, type: 'select', options: ['A', 'B'] })],
    } as unknown as BookContext;
    expect(questionPrompt(ctx)).toBe(
      'A few questions\n\nCompany (optional — reply "skip")\n1. A\n2. B',
    );
  });

  it('names a variable after the label', () => {
    expect(slugOf('Your Company Name?')).toBe('your_company_name');
  });
});

describe('the confirmation', () => {
  it('fills slot, type and the manage link, and adds the link when the author did not place it', () => {
    expect(
      confirmationText('Booked {{slot}} for {{type}}', 'Tue 10:00', 'Haircut', 'https://x/b'),
    ).toBe('Booked Tue 10:00 for Haircut\n\nReschedule or cancel: https://x/b');
    expect(confirmationText('See {{ manage_link }}', 'Tue', 'Haircut', 'https://x/b')).toBe(
      'See https://x/b',
    );
    expect(confirmationText('Hi', 'Tue', '', '')).toBe('Hi');
  });
});

describe('compileGraph for the commerce group', () => {
  it('shapes book_appointment with the builder defaults', () => {
    expect(shapeCommerceNode('book_appointment', {})).toMatchObject({
      slotCount: 5,
      prompt: 'Pick a time that works for you:',
      confirmation: '✅ Booked! See you on {{slot}}.',
      collectEmail: false,
    });
  });

  it('gives booked and no_slots their ports', () => {
    const g = compileGraph({
      flowNodes: [
        { id: 'b', type: 'book_appointment', data: {} },
        { id: 'x', type: 'end' },
        { id: 'y', type: 'end' },
      ],
      flowEdges: [
        { source: 'b', sourceHandle: 'booked', target: 'x' },
        { source: 'b', sourceHandle: 'no_slots', target: 'y' },
      ],
    });
    expect(g.nodes[0]!.type).toBe('BookAppointment');
    expect(g.edges).toEqual([
      { from: 'b_1', to: 'x' },
      { from: 'b_2', to: 'y' },
    ]);
  });

  it('keeps the shop products from every shape the builder saved, at most 30', () => {
    const items = shapeCommerceNode('whatsapp_shop', {
      productItems: [{ retailer_id: 'a', price_minor: 1000 }, { retailer_id: '' }],
    }) as { products: Array<{ retailerId: string; priceMinor: number }> };
    expect(items.products).toEqual([
      expect.objectContaining({ retailerId: 'a', priceMinor: 1000 }),
    ]);
    expect(
      (shapeCommerceNode('shopify', { productIds: ['p1', 'p2'] }) as { products: unknown[] })
        .products,
    ).toHaveLength(2);
    expect(
      (shapeCommerceNode('woocommerce', { product: 'solo' }) as { products: unknown[] }).products,
    ).toHaveLength(1);
    const big = Array.from({ length: 40 }, (_, i) => ({ retailer_id: `p${i}` }));
    expect(
      (shapeCommerceNode('shopify', { productItems: big }) as { products: unknown[] }).products,
    ).toHaveLength(30);
  });

  it('wa_form keeps its defaults and a clean variable name', () => {
    expect(
      shapeCommerceNode('wa_form', { formId: ' 7 ', flowVariable: '{{ my_form }}' }),
    ).toMatchObject({
      formId: '7',
      bodyText: 'Please tap below to fill out our form.',
      ctaLabel: 'Open form',
      flowVariable: 'my_form',
    });
  });
});
