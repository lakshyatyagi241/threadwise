import { createTaxRateSchema, TAX_TYPES, updateTaxRateSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  componentsTotal,
  emptyTaxRateForm,
  isPercent,
  percentUnits,
  splitEvenly,
  TAX_TYPE_ORDER,
  toCreateInput,
  toUpdatePatch,
  unitsToPercent,
  validateTaxRateForm,
} from './tax-rate-form';

const gst = (over = {}) =>
  emptyTaxRateForm({
    name: 'GST 18%',
    type: 'gst',
    rate: '18',
    compound: true,
    components: [
      { type: 'CGST', rate: '9' },
      { type: 'SGST', rate: '9' },
    ],
    ...over,
  });

describe('tax type order', () => {
  it('lists every contract type exactly once', () => {
    expect([...TAX_TYPE_ORDER].sort()).toEqual([...TAX_TYPES].sort());
  });
});

describe('percent', () => {
  it('accepts up to 4 decimals and 100', () => {
    for (const ok of ['0', '18', '7.25', '9.975', '10.6667', '100', '100.0000'])
      expect(isPercent(ok), ok).toBe(true);
  });
  it('rejects the rest', () => {
    for (const bad of ['', 'abc', '-1', '18.', '1.23456', '100.0001', '101', '1000', '18%', '1,5'])
      expect(isPercent(bad), bad).toBe(false);
  });
  it('is exact in units of 1/10000 percent', () => {
    expect(percentUnits('9.975')).toBe(99750);
    expect(percentUnits('10.6667')).toBe(106667);
    expect(unitsToPercent(99750)).toBe('9.975');
    expect(unitsToPercent(180000)).toBe('18');
    expect(unitsToPercent(0)).toBe('0');
    expect(unitsToPercent(70000 + 2500)).toBe('7.25');
  });
});

describe('components', () => {
  it('add up without float drift', () => {
    expect(
      componentsTotal([
        { type: 'A', rate: '0.1' },
        { type: 'B', rate: '0.2' },
      ]),
    ).toBe('0.3');
    expect(
      componentsTotal([
        { type: 'GST', rate: '5' },
        { type: 'QST', rate: '9.975' },
      ]),
    ).toBe('14.975');
    expect(componentsTotal([{ type: 'A', rate: 'x' }])).toBeNull();
  });
  it('a compound rate must add up to the rate', () => {
    expect(validateTaxRateForm(gst())).toEqual({});
    expect(validateTaxRateForm(gst({ rate: '12' })).components).toBe('componentsSum');
    expect(validateTaxRateForm(gst({ rate: '18.0' }))).toEqual({});
  });
  it('flags missing, untyped and malformed parts', () => {
    expect(validateTaxRateForm(gst({ components: [] })).components).toBe('componentsMissing');
    expect(validateTaxRateForm(gst({ components: [{ type: '', rate: '18' }] })).components).toBe(
      'componentTypeRequired',
    );
    expect(
      validateTaxRateForm(gst({ components: [{ type: 'IGST', rate: '1.23456' }] })).components,
    ).toBe('componentRateInvalid');
  });
  it('are ignored for a simple rate', () => {
    expect(validateTaxRateForm(gst({ compound: false, components: [] }))).toEqual({});
    expect(toCreateInput(gst({ compound: false })).components).toBeNull();
  });
  it('splits a rate evenly with the remainder on the last part', () => {
    expect(splitEvenly('18', ['CGST', 'SGST'])).toEqual([
      { type: 'CGST', rate: '9' },
      { type: 'SGST', rate: '9' },
    ]);
    expect(splitEvenly('0.0003', ['A', 'B'])).toEqual([
      { type: 'A', rate: '0.0001' },
      { type: 'B', rate: '0.0002' },
    ]);
    expect(splitEvenly('', ['A'])).toEqual([{ type: 'A', rate: '' }]);
  });
});

describe('the other fields', () => {
  it('needs a name no longer than the limit', () => {
    expect(validateTaxRateForm(gst({ name: '  ' })).name).toBe('nameRequired');
    expect(validateTaxRateForm(gst({ name: 'x'.repeat(61) })).name).toBe('nameTooLong');
  });
  it('checks country, hsn and the effective window', () => {
    expect(validateTaxRateForm(gst({ country: 'IND' })).country).toBe('countryInvalid');
    expect(validateTaxRateForm(gst({ defaultHsnSac: '9' })).defaultHsnSac).toBe('hsnInvalid');
    expect(validateTaxRateForm(gst({ effectiveFrom: '2026-02-30' })).effectiveFrom).toBe(
      'dateInvalid',
    );
    expect(
      validateTaxRateForm(gst({ effectiveFrom: '2026-05-01', effectiveTo: '2026-04-01' }))
        .effectiveTo,
    ).toBe('dateOrder');
    expect(
      validateTaxRateForm(gst({ effectiveFrom: '2026-04-01', effectiveTo: '2026-04-01' })),
    ).toEqual({});
  });
});

describe('payloads', () => {
  it('a valid form is accepted by the contract schemas', () => {
    const f = gst({
      country: 'in',
      region: '',
      defaultHsnSac: '9983',
      effectiveFrom: '2026-01-01',
      isDefault: true,
    });
    expect(validateTaxRateForm(f)).toEqual({});
    const create = createTaxRateSchema.parse(toCreateInput(f));
    expect(create).toMatchObject({
      name: 'GST 18%',
      rate: '18',
      country: 'IN',
      region: null,
      isDefault: true,
      isActive: true,
    });
    const patch = updateTaxRateSchema.parse({ ...toUpdatePatch(f), rowVersion: 2 });
    expect(patch.components).toHaveLength(2);
  });
  it('clearing an optional field sends null so the server clears it', () => {
    const p = toUpdatePatch(emptyTaxRateForm({ name: 'VAT', rate: '20' }));
    expect(p).toMatchObject({
      description: null,
      country: null,
      effectiveFrom: null,
      effectiveTo: null,
      defaultHsnSac: null,
      components: null,
    });
  });
  it('normalises the rate text', () => {
    expect(toCreateInput(gst({ rate: '18.0000', compound: false })).rate).toBe('18');
  });
});
