import { describe, expect, it } from 'vitest';
import type { CompanyResponse } from '@crm/contracts';
import {
  EMPTY_FORM,
  LIMITS,
  fromCompany,
  toCreateInput,
  toUpdateInput,
  validate,
  websiteHref,
} from './form';

const company: CompanyResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'COM-00001',
  name: 'Acme',
  website: 'acme.test',
  email: 'ops@acme.test',
  phone: '+1 555 0100',
  industry: 'Retail',
  sizeRange: '11-50',
  address: '1 Main St',
  notes: 'Key account',
  customFields: {},
  owner: { id: '22222222-2222-4222-8222-222222222222', name: 'Asha' },
  createdBy: null,
  rollup: { contacts: 0, deals: null },
  rowVersion: 4,
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
};

describe('validate (Reference limits, caught before the call)', () => {
  it('only the name is required', () => {
    expect(validate(EMPTY_FORM)).toEqual({ name: 'required' });
    expect(validate({ ...EMPTY_FORM, name: '   ' })).toEqual({ name: 'required' });
    expect(validate({ ...EMPTY_FORM, name: 'Acme' })).toEqual({});
  });

  it('each field has its Reference maximum', () => {
    expect(LIMITS).toEqual({
      name: 191,
      industry: 100,
      website: 191,
      email: 191,
      phone: 32,
      sizeRange: 40,
      address: 500,
      notes: 2000,
    });
    for (const key of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      const base = { ...EMPTY_FORM, name: 'A' };
      const ok = { ...base, [key]: 'x'.repeat(LIMITS[key]) };
      const over = { ...base, [key]: 'x'.repeat(LIMITS[key] + 1) };
      if (key !== 'email') expect(validate(ok), `${key} at the limit`).toEqual({});
      expect(validate(over)[key], `${key} over the limit`).toBeDefined();
    }
  });

  it('an email must look like an address; blank is fine; the website and phone are free text', () => {
    expect(validate({ ...EMPTY_FORM, name: 'A', email: 'nope' })).toEqual({ email: 'email' });
    expect(validate({ ...EMPTY_FORM, name: 'A', email: 'a@b.co' })).toEqual({});
    expect(validate({ ...EMPTY_FORM, name: 'A', email: '' })).toEqual({});
    expect(validate({ ...EMPTY_FORM, name: 'A', website: 'not a url', phone: 'call me' })).toEqual(
      {},
    );
  });

  it('measures the trimmed text, as the API does', () => {
    const padded = ' '.repeat(10) + 'x'.repeat(LIMITS.phone);
    expect(validate({ ...EMPTY_FORM, name: 'A', phone: padded })).toEqual({});
  });
});

describe('toCreateInput', () => {
  it('trims, turns blanks into null and always names the owner', () => {
    expect(
      toCreateInput({
        ...EMPTY_FORM,
        name: '  Acme  ',
        industry: ' ',
        email: ' a@b.co ',
        ownerId: 'me',
      }),
    ).toEqual({
      name: 'Acme',
      industry: null,
      website: null,
      email: 'a@b.co',
      phone: null,
      sizeRange: null,
      address: null,
      notes: null,
      ownerId: 'me',
    });
    expect(toCreateInput({ ...EMPTY_FORM, name: 'A' }).ownerId).toBeNull();
  });
});

describe('toUpdateInput (only what changed)', () => {
  it('is null when nothing changed, so no call and no new version', () => {
    expect(toUpdateInput(fromCompany(company), company)).toBeNull();
    expect(toUpdateInput({ ...fromCompany(company), name: '  Acme ' }, company)).toBeNull();
  });

  it('sends the changed fields and the version that was read', () => {
    expect(toUpdateInput({ ...fromCompany(company), phone: '123' }, company)).toEqual({
      phone: '123',
      rowVersion: 4,
    });
  });

  it('a cleared field is null and a changed owner is the new id; nobody is null', () => {
    const v = { ...fromCompany(company), industry: '', ownerId: '' };
    expect(toUpdateInput(v, company)).toEqual({ industry: null, ownerId: null, rowVersion: 4 });
    expect(toUpdateInput({ ...fromCompany(company), ownerId: 'other' }, company)).toEqual({
      ownerId: 'other',
      rowVersion: 4,
    });
  });

  it('the form starts from the company', () => {
    expect(fromCompany({ ...company, industry: null, owner: null })).toMatchObject({
      industry: '',
      ownerId: '',
      name: 'Acme',
      website: 'acme.test',
    });
  });
});

describe('websiteHref (Reference printed a dead link)', () => {
  it('gives a bare domain https and keeps a real http(s) address', () => {
    expect(websiteHref('acme.test')).toBe('https://acme.test/');
    expect(websiteHref(' www.acme.test/path ')).toBe('https://www.acme.test/path');
    expect(websiteHref('http://acme.test')).toBe('http://acme.test/');
  });

  it('is not a link for anything that is not plain http(s)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>1</script>',
      'mailto:a@b.co',
      'ftp://acme.test',
      'visit our shop',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(websiteHref(bad), String(bad)).toBeNull();
    }
  });
});
