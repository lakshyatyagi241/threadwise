import { ERROR_CODES, type StatusOptionResponse } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { selectionBody } from '../api/bulk';
import { sampleCsv } from '../api/import-export';
import type { ContactRow } from '../api/schemas';
import { ApiError } from '@/lib/api/errors';
import { deleteFailure, errorKind, fieldErrors, planLimitOf } from './errors';
import { stageChoices, statusChoices } from './option-sets';
import { rowView } from './row-view';

describe('errorKind', () => {
  const api = (status: number, code: string) => new ApiError(status, code, 'x');

  it('branches on the code, never the text', () => {
    expect(errorKind(api(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(errorKind(api(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe('conflict');
    expect(errorKind(api(409, ERROR_CODES.FIELD_KEY_TAKEN))).toBe('keyTaken');
    expect(errorKind(api(409, ERROR_CODES.FIELD_IS_SYSTEM))).toBe('systemField');
    expect(errorKind(api(422, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
  });

  it('knows the contacts-domain codes', () => {
    expect(errorKind(api(409, ERROR_CODES.CON_GROUP_NAME_TAKEN))).toBe('nameTaken');
    expect(errorKind(api(409, ERROR_CODES.CON_ATTRIBUTE_IN_USE))).toBe('attributeInUse');
    expect(errorKind(api(422, ERROR_CODES.CON_ATTRIBUTE_KEY_RESERVED))).toBe('reservedKey');
    expect(errorKind(api(422, ERROR_CODES.CON_IMPORT_FILE_INVALID))).toBe('importFile');
    expect(errorKind(api(413, ERROR_CODES.CON_IMPORT_TOO_LARGE))).toBe('tooLarge');
    expect(errorKind(api(422, ERROR_CODES.CON_EXPORT_TOO_LARGE))).toBe('tooLarge');
    expect(errorKind(api(403, ERROR_CODES.CON_MERGE_SCOPE_REQUIRED))).toBe('mergeScope');
    expect(errorKind(api(422, ERROR_CODES.CON_REQUIRED_PROPERTY_MISSING))).toBe('requiredProperty');
    expect(errorKind(api(422, ERROR_CODES.CON_LOST_REASON_REQUIRED))).toBe('lostReason');
    expect(errorKind(api(422, ERROR_CODES.STATUS_OPTION_FLAG_INVALID))).toBe('stageFlag');
  });

  it('treats a missing route as "not available yet" and a network failure as a network problem', () => {
    expect(errorKind(api(404, 'UNKNOWN'))).toBe('unavailable');
    expect(errorKind(api(501, 'UNKNOWN'))).toBe('unavailable');
    expect(errorKind(new TypeError('fetch failed'))).toBe('network');
    expect(errorKind(api(500, 'INTERNAL'))).toBe('unexpected');
  });

  it('maps per-field server errors, first message per path', () => {
    const e = new ApiError(422, ERROR_CODES.VALIDATION_FAILED, 'x', undefined, [
      { path: 'email', message: 'bad' },
      { path: 'email', message: 'worse' },
      { path: 'phone', message: 'nope' },
    ]);
    expect(fieldErrors(e)).toEqual({ email: 'bad', phone: 'nope' });
  });
});

describe('option sets', () => {
  const opt = (over: Partial<StatusOptionResponse>): StatusOptionResponse => ({
    id: 'a',
    moduleKey: 'contacts',
    optionGroup: 'lifecycle_stage',
    value: 'x',
    label: 'X',
    color: null,
    position: 0,
    isDefault: false,
    isActive: true,
    isWon: false,
    isLost: false,
    stageOptionId: null,
    rowVersion: 1,
    ...over,
  });

  it('uses the platform stages when the workspace configured none', () => {
    const stages = stageChoices(undefined);
    expect(stages[0]).toEqual({ value: 'new', label: 'New' });
    expect(stages.some((s) => s.value === 'application_started')).toBe(true);
  });

  it('prefers configured stages, in position order, hiding inactive ones', () => {
    const stages = stageChoices([
      opt({ value: 'b', label: 'Beta', position: 2 }),
      opt({ value: 'a', label: 'Alpha', position: 1 }),
      opt({ value: 'z', label: 'Zed', isActive: false }),
    ]);
    expect(stages.map((s) => s.value)).toEqual(['a', 'b']);
  });

  it('keeps a value the contact already has even when it is not offered', () => {
    expect(stageChoices(undefined, 'legacy_stage').at(-1)).toEqual({
      value: 'legacy_stage',
      label: 'Legacy Stage',
    });
  });

  it('falls back to the four WaDesk statuses', () => {
    expect(statusChoices(undefined, (v) => v.toUpperCase()).map((s) => s.value)).toEqual([
      'active',
      'prospect',
      'customer',
      'vip',
    ]);
  });
});

const baseRow = {
  id: '294dca7c-5806-4548-9035-dcca9befc7b1',
  name: 'Aarav Sharma',
  firstName: null,
  lastName: null,
  email: 'a@x.io',
  phone: '+919876543210',
  lifecycleStage: 'new',
  status: null,
  isUnsubscribed: false,
  customFields: { language: 'English', memo: 'VIP', order_id: 'A12', status: 'vip' },
} as unknown as ContactRow;

describe('rowView', () => {
  it('takes group and tag chips from the expanded row', () => {
    const v = rowView(
      {
        ...baseRow,
        groups: [{ id: 'g1', name: 'VIP', color: '#7C3AED' }],
        tags: [{ id: 't1', name: 'Hot', color: null }],
      },
      new Map(),
    );
    expect(v.groups).toEqual([{ id: 'g1', name: 'VIP', color: '#7C3AED' }]);
    expect(v.tags).toEqual([{ id: 't1', name: 'Hot', color: null }]);
  });

  it('pulls language and memo out of the reserved keys and leaves the rest as attribute chips', () => {
    const v = rowView(baseRow, new Map([['order_id', 'Order ID']]));
    expect(v).toMatchObject({ language: 'English', memo: 'VIP', phone: '+91 98765 43210' });
    expect(v.attributes.map((a) => a.full)).toEqual(['Order ID: A12']);
  });

  it('keeps every scalar custom value for the attribute columns, and the creation time', () => {
    const v = rowView(
      {
        ...baseRow,
        createdAt: '2026-03-05T10:00:00.000Z',
        customFields: { order_count: 3, vip: true, note: '  ', nested: { a: 1 }, order_id: 'A12' },
      },
      new Map(),
    );
    expect(v.custom).toEqual({ order_count: '3', vip: 'true', order_id: 'A12' });
    expect(v.createdAt).toBe('2026-03-05T10:00:00.000Z');
  });

  it('flags an opted-out contact', () => {
    expect(rowView({ ...baseRow, isUnsubscribed: true }, new Map()).optedOut).toBe(true);
  });
});

describe('selectionBody (WD-CON-019)', () => {
  const filter = {
    q: 'acme',
    lifecycleStage: '',
    group: 'no_group',
    tag: '',
    consent: 'unsubscribed' as const,
    imported: false,
  };

  it('sends explicit ids as they are', () => {
    expect(selectionBody({ kind: 'ids', ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] });
  });

  it('sends "all matching" as the saved filter, so every action honours it', () => {
    expect(selectionBody({ kind: 'filter', filter })).toEqual({
      filter: {
        q: 'acme',
        lifecycleStage: undefined,
        groupId: undefined,
        noGroup: true,
        tagIds: undefined,
        unsubscribed: true,
        imported: undefined,
      },
    });
  });
});

describe('sampleCsv (WD-CON-032)', () => {
  it('is built from the importer header names, with a quoted multi-group cell', () => {
    const lines = sampleCsv().trim().split('\r\n');
    expect(lines[0]).toBe('name,last_name,country_code,mobile,email,group,language');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"VIP, New leads"');
  });
});

describe('deleteFailure', () => {
  const api = (status: number, code: string) => new ApiError(status, code, 'x');

  it('a contact that is already gone is "gone", not "this action is not available yet"', () => {
    expect(deleteFailure(api(404, ERROR_CODES.NOT_FOUND))).toBe('gone');
    expect(deleteFailure(api(404, 'UNKNOWN'))).toBe('gone');
  });

  it('keeps forbidden and everything else as before', () => {
    expect(deleteFailure(api(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(deleteFailure(api(500, 'INTERNAL'))).toBe('failed');
    expect(deleteFailure(new TypeError('fetch failed'))).toBe('failed');
  });
});

describe('plan limit (WD-CON-026)', () => {
  const full = new ApiError(422, ERROR_CODES.PLAN_LIMIT_REACHED, 'x', undefined, [
    { path: 'limit', message: 'contacts' },
    { path: 'used', message: '500' },
    { path: 'limitValue', message: '500' },
  ]);

  it('a create refused at the cap is a plan-limit message, not "something went wrong"', () => {
    expect(errorKind(full)).toBe('planLimit');
  });

  it('reads the cap from the answer, and tolerates an answer without one', () => {
    expect(planLimitOf(full)).toBe(500);
    expect(planLimitOf(new ApiError(422, ERROR_CODES.PLAN_LIMIT_REACHED, 'x'))).toBeUndefined();
    expect(planLimitOf(new TypeError('x'))).toBeUndefined();
  });
});
