import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  type ProductResponse,
  type ProductVariantResponse,
} from '@crm/contracts';
import { EMPTY_PRODUCT_FORM, buildInput, validate } from './product-form';
import {
  EMPTY_VARIANTS,
  addValue,
  addValues,
  bulkFill,
  buildVariantsBody,
  droppedWithData,
  fromPrice,
  hasVariantProblems,
  newRow,
  regenerateRows,
  stockTotal,
  validateVariants,
  variantCount,
  variantPathOf,
  variantsFromProduct,
  withPreset,
  type OptionDraft,
  type VariantRow,
  type VariantsState,
} from './variants-model';

const opts = (...o: [string, string[]][]): OptionDraft[] =>
  o.map(([name, values]) => ({ name, values }));
const row = (optionValues: string[], over: Partial<VariantRow> = {}): VariantRow => ({
  ...newRow(optionValues),
  ...over,
});
const state = (o: OptionDraft[], rows: VariantRow[]): VariantsState => ({
  enabled: true,
  options: o,
  rows,
});

describe('regenerateRows', () => {
  const size = opts(['Size', ['S', 'M']]);
  it('builds every combination with the first option varying slowest', () => {
    const r = regenerateRows([], [], opts(['Size', ['S', 'M']], ['Colour', ['Red', 'Blue']]));
    expect(r.rows.map((x) => x.optionValues.join('/'))).toEqual([
      'S/Red',
      'S/Blue',
      'M/Red',
      'M/Blue',
    ]);
    expect(r.dropped).toEqual([]);
  });
  it('keeps what was typed for a combination that survives, matched by title', () => {
    const prev = [row(['S'], { sku: 'T-S', priceMajor: '10' }), row(['M'], { stockQty: '4' })];
    const r = regenerateRows(size, prev, opts(['Size', ['M', 'S', 'L']]));
    expect(r.rows.map((x) => [x.optionValues[0], x.sku, x.priceMajor, x.stockQty])).toEqual([
      ['M', '', '', '4'],
      ['S', 'T-S', '10', ''],
      ['L', '', '', ''],
    ]);
  });
  it('keeps the server id so an existing variant is updated, not recreated', () => {
    const prev = [row(['S'], { id: '11111111-1111-4111-8111-111111111111' })];
    const r = regenerateRows(size, prev, opts(['Size', ['S', 'XL']]));
    expect(r.rows[0]?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(r.rows[1]?.id).toBeUndefined();
  });
  it('keeps rows when options are reordered', () => {
    const before = opts(['Size', ['S']], ['Colour', ['Red']]);
    const prev = [row(['S', 'Red'], { sku: 'X' })];
    const r = regenerateRows(before, prev, [before[1]!, before[0]!]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ optionValues: ['Red', 'S'], sku: 'X' });
    expect(r.dropped).toEqual([]);
  });
  it('reports dropped rows and only asks about the ones holding data', () => {
    const prev = [row(['S']), row(['M'], { stockQty: '3' }), row(['L'], { active: false })];
    const r = regenerateRows(size, prev, opts(['Size', ['S']]));
    expect(r.dropped.map((x) => x.optionValues[0])).toEqual(['M', 'L']);
    expect(droppedWithData(r).map((x) => x.optionValues[0])).toEqual(['M', 'L']);
    expect(
      droppedWithData(regenerateRows(size, [row(['S']), row(['M'])], opts(['Size', ['S']]))),
    ).toEqual([]);
  });
  it('leaves the table alone while an option has no values yet', () => {
    const prev = [row(['S'], { sku: 'A' })];
    const r = regenerateRows(size, prev, opts(['Size', ['S']], ['Colour', []]));
    expect(r.rows).toEqual(prev);
    expect(r.dropped).toEqual([]);
  });
});

describe('values and presets', () => {
  it('clothing preset adds XS-XL once, numeric shoe preset adds sizes', () => {
    expect(withPreset([], 'clothing')).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(withPreset(['m'], 'clothing')).toEqual(['m', 'XS', 'S', 'L', 'XL']);
    expect(withPreset([], 'shoes')).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });
  it('refuses empty, repeated, too long and too many values', () => {
    expect(addValue([], '  ')).toEqual({ ok: false, reason: 'empty' });
    expect(addValue(['Red'], ' red ')).toEqual({ ok: false, reason: 'dup' });
    expect(addValue([], 'x'.repeat(61))).toEqual({ ok: false, reason: 'tooLong' });
    expect(
      addValue(
        Array.from({ length: 50 }, (_, i) => `v${i}`),
        'new',
      ),
    ).toEqual({
      ok: false,
      reason: 'tooMany',
    });
    expect(addValue(['S'], ' M ')).toEqual({ ok: true, values: ['S', 'M'] });
  });
  it('splits a pasted comma list and skips repeats', () => {
    expect(addValues(['S'], 'S, M,, L ,m')).toEqual(['S', 'M', 'L']);
  });
});

describe('bulk fill and hints', () => {
  const rows = [row(['S'], { stockQty: '2' }), row(['M'], { priceMajor: '8', stockQty: '3' })];
  it('fills price and stock for every row, and an empty box clears', () => {
    expect(bulkFill(rows, { priceMajor: ' 12.5 ' }).map((r) => r.priceMajor)).toEqual([
      '12.5',
      '12.5',
    ]);
    expect(bulkFill(rows, { stockQty: '' }).map((r) => r.stockQty)).toEqual(['', '']);
    expect(bulkFill(rows, {}).map((r) => r.stockQty)).toEqual(['2', '3']);
  });
  it('sums the stock of active variants and is unlimited when one is blank', () => {
    expect(stockTotal(rows)).toEqual({ total: 5, unlimited: false });
    expect(stockTotal([...rows, row(['L'])])).toEqual({ total: 5, unlimited: true });
    expect(stockTotal([...rows, row(['L'], { active: false })])).toEqual({
      total: 5,
      unlimited: false,
    });
  });
  it('shows the lowest active price, blank following the product price', () => {
    expect(fromPrice(rows, '10')).toBe(8);
    expect(fromPrice([row(['S']), row(['M'], { priceMajor: '30' })], '10')).toBe(10);
    expect(fromPrice([row(['S'], { priceMajor: '1', active: false })], '10')).toBeNull();
    expect(fromPrice([row(['S'])], '')).toBeNull();
  });
  it('counts the variants the options make', () => {
    expect(variantCount({ options: opts(['A', ['1', '2']], ['B', ['x', 'y', 'z']]) })).toBe(6);
    expect(variantCount({ options: opts(['A', ['1']], ['B', []]) })).toBe(0);
  });
});

describe('validateVariants', () => {
  it('has nothing to say when variants are off', () => {
    expect(hasVariantProblems(validateVariants(EMPTY_VARIANTS))).toBe(false);
  });
  it('needs an option, a name and a value, and unique names and values', () => {
    expect(validateVariants({ enabled: true, options: [], rows: [] }).general).toBe('needOption');
    const p = validateVariants(state(opts(['', []], ['size', ['S', 's']], ['SIZE', ['M']]), []));
    expect(p.options[0]).toEqual({ name: 'required', values: 'needValue' });
    expect(p.options[1]).toEqual({ values: 'dupValue' });
    expect(p.options[2]).toEqual({ name: 'dupName' });
  });
  it('limits the variants to 100', () => {
    const many = (n: string) => ({ name: n, values: Array.from({ length: 11 }, (_, i) => `${i}`) });
    expect(validateVariants(state([many('a'), many('b')], [])).general).toBe('tooManyVariants');
  });
  it('checks price, stock, sku and image link of each row', () => {
    const p = validateVariants(
      state(opts(['Size', ['S', 'M', 'L']]), [
        row(['S'], { priceMajor: 'abc', stockQty: '1.5', imageUrl: 'ftp://x' }),
        row(['M'], { priceMajor: '1.234', stockQty: '2000000', sku: 'k'.repeat(97) }),
        row(['L'], { priceMajor: '10.5', stockQty: '0', imageUrl: 'https://a/b.png' }),
      ]),
    );
    expect(p.rows[0]).toEqual({
      priceMajor: 'notNumber',
      stockQty: 'notWhole',
      imageUrl: 'badUrl',
    });
    expect(p.rows[1]).toEqual({ sku: 'tooLong', priceMajor: 'notNumber', stockQty: 'outOfRange' });
    expect(p.rows[2]).toEqual({});
  });
});

describe('request body', () => {
  const s = state(opts(['Size', ['S', 'M']]), [
    row(['S'], { priceMajor: '12', stockQty: '5', sku: ' TS ' }),
    row(['M'], { id: '22222222-2222-4222-8222-222222222222', active: false }),
  ]);
  it('sends options and variants that satisfy the contract', () => {
    const input = buildInput({ ...EMPTY_PRODUCT_FORM, name: 'Tee', priceMajor: '10' }, s, false);
    expect(input.options).toEqual([{ name: 'Size', values: ['S', 'M'] }]);
    expect(input.variants?.[0]).toMatchObject({
      optionValues: ['S'],
      sku: 'TS',
      priceMajor: '12',
      stockQty: 5,
      active: true,
    });
    expect(input.variants?.[1]).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      priceMajor: null,
      stockQty: null,
      active: false,
    });
    expect(input.stockQty).toBeNull();
    expect(createProductSchema.safeParse(input).success).toBe(true);
  });
  it('sends nothing when off, and options: [] to remove stored variants', () => {
    expect(buildVariantsBody(EMPTY_VARIANTS, false)).toEqual({});
    expect(buildVariantsBody(EMPTY_VARIANTS, true)).toEqual({ options: [] });
    expect(buildVariantsBody({ ...s, enabled: false }, true)).toEqual({ options: [] });
  });
  it('does not require a typed stock quantity while variants are on', () => {
    expect(
      validate(
        { ...EMPTY_PRODUCT_FORM, name: 'T', priceMajor: '1', stockQty: 'x' },
        { variants: true },
      ),
    ).toEqual({});
    expect(
      validate({ ...EMPTY_PRODUCT_FORM, name: 'T', priceMajor: '1', stockQty: 'x' }),
    ).toHaveProperty('stockQty');
  });
});

describe('from the server and back', () => {
  const variant = (over: Partial<ProductVariantResponse>): ProductVariantResponse => ({
    id: '33333333-3333-4333-8333-333333333333',
    optionValues: ['S'],
    title: 'S',
    sku: null,
    priceMinor: 1000,
    priceMajor: '10',
    priceDisplay: '10',
    priceOverrideMajor: null,
    comparePriceMinor: null,
    comparePriceMajor: null,
    comparePriceDisplay: null,
    imageUrl: null,
    weightGrams: null,
    stockQty: null,
    reservedQty: 0,
    availableQty: null,
    active: true,
    position: 0,
    retailerId: 'P-1',
    rowVersion: 1,
    ...over,
  });
  it('turns a stored product into the editable state, then the same body', () => {
    const p = {
      hasVariants: true,
      options: [{ name: 'Size', values: ['S', 'M'] }],
      variants: [
        variant({ priceOverrideMajor: '12', stockQty: 7, sku: 'A' }),
        variant({
          id: '44444444-4444-4444-8444-444444444444',
          optionValues: ['M'],
          title: 'M',
          active: false,
        }),
      ],
    } as unknown as ProductResponse;
    const s = variantsFromProduct(p);
    expect(s.enabled).toBe(true);
    expect(s.rows[0]).toMatchObject({ priceMajor: '12.00', stockQty: '7', sku: 'A' });
    expect(s.rows[1]).toMatchObject({ priceMajor: '', stockQty: '', active: false });
    const body = buildVariantsBody(s, true);
    expect(body.variants?.map((v) => v.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
  });
  it('is off for a product without variants', () => {
    expect(variantsFromProduct({ hasVariants: false } as ProductResponse)).toBe(EMPTY_VARIANTS);
  });
});

describe('variantPathOf', () => {
  it('places server errors', () => {
    expect(variantPathOf('options.1.values.0')).toEqual({
      kind: 'option',
      index: 1,
      field: 'values',
    });
    expect(variantPathOf('options.0.name')).toEqual({ kind: 'option', index: 0, field: 'name' });
    expect(variantPathOf('variants.2.priceMajor')).toEqual({
      kind: 'row',
      index: 2,
      field: 'priceMajor',
    });
    expect(variantPathOf('variants.2.optionValues.0')).toEqual({
      kind: 'row',
      index: 2,
      field: 'other',
    });
    expect(variantPathOf('variants')).toEqual({ kind: 'general' });
    expect(variantPathOf('name')).toBeNull();
  });
});
