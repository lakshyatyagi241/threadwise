import { acmeDeal, lateDeal } from '@/test/deals-fixtures';
import {
  buildCreateBody,
  buildUpdateBody,
  contractProblems,
  emptyDeal,
  validateDeal,
  valuesOfDeal,
  type DealFormValues,
} from './deal-validation';

const ME = acmeDeal.owner!.id;
const STAGE = acmeDeal.stage.id;
const blank = emptyDeal('USD', STAGE);
const filled = (over: Partial<DealFormValues>): DealFormValues => ({
  ...blank,
  title: 'New deal',
  ...over,
});

describe('validateDeal', () => {
  it('accepts a deal with only a name', () => {
    expect(validateDeal(filled({}))).toEqual({});
  });

  it('wants a name, and not a long one', () => {
    expect(validateDeal(filled({ title: '   ' }))).toEqual({
      title: 'deals.form.errors.titleRequired',
    });
    expect(validateDeal(filled({ title: 'x'.repeat(192) }))).toEqual({
      title: 'deals.form.errors.titleTooLong',
    });
    expect(validateDeal(filled({ title: 'x'.repeat(191) }))).toEqual({});
  });

  it('refuses an amount the currency cannot hold', () => {
    expect(validateDeal(filled({ value: 'abc' })).value).toBe('deals.form.errors.valueInvalid');
    expect(validateDeal(filled({ value: '1.005' })).value).toBe('deals.form.errors.valueInvalid');
    expect(validateDeal(filled({ value: '5000.5', currency: 'JPY' })).value).toBe(
      'deals.form.errors.valueInvalid',
    );
    expect(validateDeal(filled({ value: '1,250.50' }))).toEqual({});
  });

  it('wants a real day for the expected close', () => {
    expect(validateDeal(filled({ close: '2026-02-31' })).close).toBe(
      'deals.form.errors.closeInvalid',
    );
    expect(validateDeal(filled({ close: '31/10/2026' })).close).toBe(
      'deals.form.errors.closeInvalid',
    );
    expect(validateDeal(filled({ close: '2026-10-31' }))).toEqual({});
  });
});

describe('buildCreateBody', () => {
  it('sends the name, the currency and the column, and leaves the owner to the API for "me"', () => {
    expect(buildCreateBody(filled({ title: '  Acme  ' }), 'pipe-1')).toEqual({
      title: 'Acme',
      pipelineId: 'pipe-1',
      stageId: STAGE,
      currency: 'USD',
    });
  });

  it("sends every field that is filled, the amount with the currency's decimals", () => {
    const body = buildCreateBody(
      filled({
        value: '1,250.5',
        owner: { kind: 'user', id: 'u-2', name: 'Dev' },
        contact: { id: 'c-1', name: 'Aarav' },
        close: '2026-10-31',
      }),
      undefined,
    );
    expect(body).toEqual({
      title: 'New deal',
      stageId: STAGE,
      value: '1250.50',
      currency: 'USD',
      ownerId: 'u-2',
      contactId: 'c-1',
      expectedCloseDate: '2026-10-31',
    });
  });

  it('sends null for "no owner"', () => {
    expect(buildCreateBody(filled({ owner: { kind: 'none' } }), undefined).ownerId).toBeNull();
  });

  it('leaves the amount out when it was left blank', () => {
    expect('value' in buildCreateBody(filled({ value: '   ' }), undefined)).toBe(false);
  });
});

describe('valuesOfDeal and buildUpdateBody', () => {
  it('starts the form from the deal as it is, with the caller shown as "me"', () => {
    const values = valuesOfDeal(acmeDeal, ME);
    expect(values).toMatchObject({
      title: '40 seats for Acme',
      value: '12500.00',
      currency: 'USD',
      owner: { kind: 'me' },
      contact: { id: acmeDeal.contact!.id, name: 'Aarav Sharma' },
      close: '2099-12-31',
    });
    expect(valuesOfDeal(lateDeal, ME).owner).toEqual({ kind: 'none' });
    expect(valuesOfDeal({ ...acmeDeal, owner: { id: 'u-2', name: 'Dev' } }, ME).owner).toEqual({
      kind: 'user',
      id: 'u-2',
      name: 'Dev',
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(buildUpdateBody(acmeDeal, valuesOfDeal(acmeDeal, ME), ME)).toEqual({});
  });

  it('sends only what changed', () => {
    const values = { ...valuesOfDeal(acmeDeal, ME), title: ' Renamed ', value: '13000' };
    expect(buildUpdateBody(acmeDeal, values, ME)).toEqual({ title: 'Renamed', value: '13000.00' });
  });

  it('sends the amount with a new currency, relabelled and never converted', () => {
    const values = { ...valuesOfDeal(acmeDeal, ME), currency: 'EUR' };
    expect(buildUpdateBody(acmeDeal, values, ME)).toEqual({ currency: 'EUR', value: '12500.00' });
  });

  it('clears the owner, the customer and the close day with null', () => {
    const values: DealFormValues = {
      ...valuesOfDeal(acmeDeal, ME),
      owner: { kind: 'none' },
      contact: null,
      close: '',
    };
    expect(buildUpdateBody(acmeDeal, values, ME)).toEqual({
      ownerId: null,
      contactId: null,
      expectedCloseDate: null,
    });
  });

  it('gives the deal to the caller when "me" is chosen for a deal someone else owns', () => {
    const values = { ...valuesOfDeal(lateDeal, ME), owner: { kind: 'me' } as const };
    expect(buildUpdateBody(lateDeal, values, ME)).toEqual({ ownerId: ME });
  });
});

describe('contractProblems', () => {
  it('lets a body the API accepts through', () => {
    expect(contractProblems({ title: 'A', currency: 'USD' }, 'create')).toEqual({});
    expect(contractProblems({ title: 'A', rowVersion: 1 }, 'update')).toEqual({});
  });

  it('names the field the contract refuses', () => {
    expect(contractProblems({ title: '' }, 'create')).toEqual({
      title: 'deals.form.errors.titleRequired',
    });
    expect(contractProblems({ title: 'A', expectedCloseDate: '2026-02-31' }, 'create').close).toBe(
      'deals.form.errors.closeInvalid',
    );
    expect(contractProblems({ value: '1.0005', rowVersion: 1 }, 'update').value).toBe(
      'deals.form.errors.valueInvalid',
    );
  });
});
