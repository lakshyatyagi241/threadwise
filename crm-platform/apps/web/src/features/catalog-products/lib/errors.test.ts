import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  ERROR_KINDS,
  errorDetail,
  errorKind,
  fieldErrors,
  isPlanLocked,
  isRowVersionConflict,
} from './errors';

const err = (
  status: number,
  code: string,
  message = 'text',
  fields: ApiError['fieldErrors'] = [],
) => new ApiError(status, code, message, 'req-1', fields);

describe('errorKind', () => {
  it('branches on the problem code', () => {
    expect(errorKind(err(422, 'PLAN_FEATURE_LOCKED'))).toBe('planLocked');
    expect(errorKind(err(409, 'ROW_VERSION_CONFLICT'))).toBe('conflict');
    expect(errorKind(err(422, 'CAT_META_REJECTED'))).toBe('metaRejected');
    expect(errorKind(err(422, 'CAT_NO_RECIPIENTS'))).toBe('noRecipients');
    expect(errorKind(err(422, 'CAT_TOO_MANY_RECIPIENTS'))).toBe('tooManyRecipients');
    expect(errorKind(err(422, 'CAT_NO_PRODUCTS'))).toBe('noProducts');
    expect(errorKind(err(422, 'CAT_NO_SENDER'))).toBe('noSender');
    expect(errorKind(err(422, 'CAT_NOT_CONNECTED'))).toBe('notConnected');
    expect(errorKind(err(422, 'CAT_NO_WABA'))).toBe('noWaba');
    expect(errorKind(err(422, 'CAT_WABA_TOKEN_MISSING'))).toBe('wabaToken');
    expect(errorKind(err(422, 'CAT_ALREADY_CONNECTED'))).toBe('alreadyConnected');
    expect(errorKind(err(422, 'CAT_CONFIRM_MISMATCH'))).toBe('confirmMismatch');
    expect(errorKind(err(422, 'CAT_SET_NOT_SYNCABLE'))).toBe('setNotSyncable');
    expect(errorKind(err(422, 'CAT_NO_CATALOG_LINKED'))).toBe('noCatalogLinked');
    expect(errorKind(err(422, 'CAT_COLLECTION_PRODUCTS_INVALID'))).toBe('collectionProducts');
    expect(errorKind(err(400, 'VALIDATION_FAILED'))).toBe('validation');
    expect(errorKind(err(402, 'PLAN_LIMIT_REACHED'))).toBe('planLimit');
    expect(errorKind(err(402, 'WALLET_INSUFFICIENT_FUNDS'))).toBe('wallet');
    expect(errorKind(err(403, 'AUTH_SEND_HALTED'))).toBe('sendBlocked');
  });

  it('never reads the message text', () => {
    expect(errorKind(err(422, 'SOMETHING_ELSE', 'PLAN_FEATURE_LOCKED'))).toBe('unexpected');
  });

  it('treats a route that is not deployed as unavailable and a thrown error as network', () => {
    expect(errorKind(err(404, 'UNKNOWN'))).toBe('unavailable');
    expect(errorKind(err(501, 'UNKNOWN'))).toBe('unavailable');
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('every kind a code can produce is a declared kind', () => {
    const kinds = [
      'FORBIDDEN',
      'UNAUTHENTICATED',
      'RATE_LIMITED',
      'NOT_FOUND',
      'CAT_SEND_FAILED',
      'CAT_PROVIDER_FAILED',
    ].map((c) => errorKind(err(400, c)));
    for (const k of kinds) expect(ERROR_KINDS).toContain(k);
  });
});

describe('errorDetail', () => {
  it('carries Meta and provider text only for the kinds that show it', () => {
    expect(errorDetail(err(422, 'CAT_META_REJECTED', 'Unsupported get request (code 100)'))).toBe(
      'Unsupported get request (code 100)',
    );
    expect(errorDetail(err(502, 'CAT_PROVIDER_FAILED', 'timeout'))).toBe('timeout');
    expect(errorDetail(err(422, 'CAT_NO_RECIPIENTS', 'Pick a contact'))).toBe('');
    expect(errorDetail(new Error('x'))).toBe('');
  });
});

describe('helpers', () => {
  it('detects plan lock and row-version conflicts', () => {
    expect(isPlanLocked(err(422, 'PLAN_FEATURE_LOCKED'))).toBe(true);
    expect(isPlanLocked(err(500, 'INTERNAL'))).toBe(false);
    expect(isRowVersionConflict(err(409, 'ROW_VERSION_CONFLICT'))).toBe(true);
    expect(isRowVersionConflict(err(409, 'CONFLICT'))).toBe(false);
  });

  it('keeps the first message per field', () => {
    const e = err(400, 'VALIDATION_FAILED', 'x', [
      { path: 'priceMajor', message: 'Enter a number' },
      { path: 'priceMajor', message: 'Second' },
      { path: 'name', message: 'Required' },
    ]);
    expect(fieldErrors(e)).toEqual({ priceMajor: 'Enter a number', name: 'Required' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});
