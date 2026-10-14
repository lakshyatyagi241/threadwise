import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type EmailTemplate } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { errorKind } from './errors';
import {
  DEFAULT_FILTERS,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
} from './filters';
import { EMPTY_FORM, fromTemplate, toCreateInput, toUpdateInput, validate } from './form';

const params = (s: string) => new URLSearchParams(s);

describe('filters', () => {
  it('reads nothing as the default list: active templates of everyone, no search', () => {
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(hasActiveFilter(DEFAULT_FILTERS)).toBe(false);
  });

  it('round-trips a set of filters through the address', () => {
    const f = {
      q: 'welcome',
      scope: 'mine' as const,
      purpose: 'marketing' as const,
      status: 'archived' as const,
      category: 'Onboarding',
    };
    const search = filtersToSearch(f);
    expect(parseFilters(params(search))).toEqual(f);
    expect(hasActiveFilter(f)).toBe(true);
  });

  it('falls back to the default for a value that is not one of ours', () => {
    const f = parseFilters(params('scope=everyone&purpose=spam&status=deleted'));
    expect(f.scope).toBe('all');
    expect(f.purpose).toBe('');
    expect(f.status).toBe('active');
  });

  it('only a status other than active counts as a filter, and a search is trimmed', () => {
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, status: 'all' })).toBe(true);
    expect(hasActiveFilter({ ...DEFAULT_FILTERS, q: '   ' })).toBe(false);
    expect(filtersToSearch({ ...DEFAULT_FILTERS, q: '  a b  ' })).toBe('?q=a+b');
  });

  it('asks the API only for what is set', () => {
    expect(listQuery(DEFAULT_FILTERS)).toEqual({ scope: 'all', status: 'active' });
    expect(listQuery({ ...DEFAULT_FILTERS, q: ' x ', purpose: 'general', category: 'C' })).toEqual({
      scope: 'all',
      status: 'active',
      q: 'x',
      purpose: 'general',
      category: 'C',
    });
  });
});

describe('errorKind', () => {
  const err = (status: number, code: string) =>
    new ApiError(status, code, 'whatever the server said');

  it('chooses by code, not by wording', () => {
    expect(errorKind(err(409, ERROR_CODES.EMAIL_TEMPLATE_NAME_TAKEN))).toBe('nameTaken');
    expect(errorKind(err(403, ERROR_CODES.EMAIL_TEMPLATE_NOT_EDITABLE))).toBe('notEditable');
    expect(errorKind(err(422, ERROR_CODES.EMAIL_TEMPLATE_ARCHIVED))).toBe('archived');
    expect(errorKind(err(404, ERROR_CODES.EMAIL_TEMPLATE_NOT_FOUND))).toBe('notFound');
    expect(errorKind(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe('conflict');
    expect(errorKind(err(422, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('planDisabled');
    expect(errorKind(err(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
  });

  it('a route that is not deployed is "unavailable", a broken connection is "network"', () => {
    expect(errorKind(err(404, 'SOMETHING_ELSE'))).toBe('unavailable');
    expect(errorKind(err(500, 'INTERNAL'))).toBe('unexpected');
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
  });
});

const template = (over: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: '9a6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f99',
  name: 'Welcome',
  subject: 'Hi {{first_name}}',
  bodyHtml: '<p>Hello {{first_name}}</p>',
  bodyText: 'Hello {{first_name}}',
  category: 'Onboarding',
  purpose: 'general',
  scope: 'shared',
  status: 'active',
  variables: ['first_name'],
  usedCount: 0,
  lastUsedAt: null,
  createdByName: 'Sam',
  canEdit: true,
  rowVersion: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('the form', () => {
  const ok = { ...EMPTY_FORM, name: 'Welcome', html: '<p>Hi</p>' };

  it('needs a name and a body that has text, not just empty markup', () => {
    expect(validate(ok)).toEqual({});
    expect(validate({ ...ok, name: '   ' }).name).toBe('required');
    expect(validate({ ...ok, html: '<p><br></p>' }).html).toBe('required');
    expect(validate({ ...ok, html: '' }).html).toBe('required');
  });

  it('refuses a name, subject and category over their limits and a subject with a line break', () => {
    expect(validate({ ...ok, name: 'x'.repeat(121) }).name).toBe('tooLong');
    expect(validate({ ...ok, subject: 'x'.repeat(301) }).subject).toBe('tooLong');
    expect(validate({ ...ok, subject: 'a\nb' }).subject).toBe('subjectLines');
    expect(validate({ ...ok, category: 'x'.repeat(65) }).category).toBe('tooLong');
  });

  it('creating trims, sends no category when blank and keeps the chosen scope and type', () => {
    expect(
      toCreateInput({
        ...ok,
        name: '  Welcome ',
        subject: ' Hi ',
        category: ' ',
        scope: 'mine',
        purpose: 'marketing',
      }),
    ).toEqual({
      name: 'Welcome',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
      bodyText: '',
      category: null,
      purpose: 'marketing',
      scope: 'mine',
    });
  });

  it('editing sends only what changed with the version read, and nothing when nothing changed', () => {
    const t = template();
    expect(toUpdateInput(fromTemplate(t), t)).toBeNull();
    expect(toUpdateInput({ ...fromTemplate(t), name: ' Welcome ' }, t)).toBeNull();
    expect(toUpdateInput({ ...fromTemplate(t), subject: 'New' }, t)).toEqual({
      subject: 'New',
      rowVersion: 3,
    });
    expect(toUpdateInput({ ...fromTemplate(t), category: '' }, t)).toEqual({
      category: null,
      rowVersion: 3,
    });
    // a new body asks the server to derive the text twin again
    expect(toUpdateInput({ ...fromTemplate(t), html: '<p>New</p>' }, t)).toEqual({
      bodyHtml: '<p>New</p>',
      bodyText: '',
      rowVersion: 3,
    });
  });

  it('a personal template stays personal in the form', () => {
    expect(fromTemplate(template({ scope: 'mine' })).scope).toBe('mine');
  });
});
