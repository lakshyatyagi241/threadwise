import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  MARKET_ERROR_KEYS,
  isConflict,
  isNoAccess,
  marketError,
  serverProblems,
  splitServerPath,
} from './errors';

const api = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'English text that is never read', 'req-1', fieldErrors);

describe('splitServerPath', () => {
  it('sends manifest. and recipe. paths to their editors and anything else to a form field', () => {
    expect(splitServerPath('manifest.scopes.0')).toEqual({ target: 'manifest', path: 'scopes.0' });
    expect(splitServerPath('manifest')).toEqual({ target: 'manifest', path: '' });
    expect(splitServerPath('recipe.connector.type')).toEqual({
      target: 'recipe',
      path: 'connector.type',
    });
    expect(splitServerPath('recipe')).toEqual({ target: 'recipe', path: '' });
    expect(splitServerPath('listing.logo')).toEqual({ target: 'field', path: 'listing.logo' });
    expect(splitServerPath('manifestation')).toEqual({ target: 'field', path: 'manifestation' });
  });
});

describe('marketError: branches on the code, never the message', () => {
  it('keeps a request id and every path the API named', () => {
    const e = marketError(
      api(422, ERROR_CODES.MKT_MANIFEST_INVALID, [
        { path: 'manifest.id', message: 'Use 2 to 48 lowercase letters' },
        { path: 'manifest.scopes.1', message: 'Unknown scope "x".' },
      ]),
    );
    expect(e).toMatchObject({ kind: 'problems', key: 'manifestInvalid', requestId: 'req-1' });
    expect(e.problems).toEqual([
      { target: 'manifest', path: 'id', message: 'Use 2 to 48 lowercase letters' },
      { target: 'manifest', path: 'scopes.1', message: 'Unknown scope "x".' },
    ]);
  });

  it('maps a stale write to a reload prompt', () => {
    expect(marketError(api(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toMatchObject({
      kind: 'conflict',
      key: 'conflict',
    });
    expect(isConflict(api(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toBe(true);
    expect(isConflict(api(409, ERROR_CODES.MKT_VERSION_STATE))).toBe(false);
  });

  it('names the permission the API says is missing', () => {
    const e = marketError(
      api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, [
        { path: 'permission', message: 'platform.market.review' },
      ]),
    );
    expect(e).toMatchObject({
      kind: 'noAccess',
      key: 'noAccess',
      values: { permission: 'platform.market.review' },
    });
    expect(isNoAccess(api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED))).toBe(true);
    expect(isNoAccess(api(403, ERROR_CODES.FORBIDDEN))).toBe(true);
    expect(isNoAccess(api(422, ERROR_CODES.VALIDATION_FAILED))).toBe(false);
  });

  const cases: Array<[string, number, string, Array<{ path: string; message: string }>, string]> = [
    ['manifest invalid', 422, ERROR_CODES.MKT_MANIFEST_INVALID, [], 'manifestInvalid'],
    [
      'recipe invalid',
      422,
      ERROR_CODES.MKT_RECIPE_INVALID,
      [{ path: 'recipe.key', message: 'x' }],
      'recipeInvalid',
    ],
    [
      'url refused with a reason',
      422,
      ERROR_CODES.MKT_URL_REFUSED,
      [{ path: 'recipe.connector', message: 'private address' }],
      'urlRefused',
    ],
    ['url refused without one', 422, ERROR_CODES.MKT_URL_REFUSED, [], 'urlRefusedPlain'],
    [
      'connector not available',
      409,
      ERROR_CODES.MKT_CONNECTOR_NOT_AVAILABLE,
      [{ path: 'manifest.connector.type', message: 'pull' }],
      'connectorNotAvailable',
    ],
    ['slug taken', 409, ERROR_CODES.MKT_SLUG_TAKEN, [], 'slugTaken'],
    [
      'category unknown in a manifest',
      422,
      ERROR_CODES.MKT_CATEGORY_NOT_FOUND,
      [{ path: 'manifest.category', message: 'unknown' }],
      'categoryUnknown',
    ],
    ['category gone', 404, ERROR_CODES.MKT_CATEGORY_NOT_FOUND, [], 'categoryGone'],
    ['category in use', 409, ERROR_CODES.MKT_CATEGORY_IN_USE, [], 'categoryInUse'],
    [
      'version state with the status',
      409,
      ERROR_CODES.MKT_VERSION_STATE,
      [{ path: 'status', message: 'in_review' }],
      'versionState',
    ],
    ['version state without it', 409, ERROR_CODES.MKT_VERSION_STATE, [], 'versionStatePlain'],
    [
      'version exists with the highest',
      409,
      ERROR_CODES.MKT_VERSION_EXISTS,
      [{ path: 'manifest.version', message: 'higher_than:1.2.0' }],
      'versionExists',
    ],
    ['version exists plain', 409, ERROR_CODES.MKT_VERSION_EXISTS, [], 'versionExistsPlain'],
    ['app unavailable (killed)', 409, ERROR_CODES.MKT_APP_UNAVAILABLE, [], 'appUnavailable'],
    ['app not found', 404, ERROR_CODES.MKT_APP_NOT_FOUND, [], 'appNotFound'],
    [
      'subscription in the wrong state (a workspace that pays, a free app, an ended one)',
      409,
      ERROR_CODES.MKT_SUBSCRIPTION_STATE,
      [],
      'subscriptionState',
    ],
    [
      'subscription not found',
      404,
      ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
      [],
      'subscriptionNotFound',
    ],
    ['not found', 404, ERROR_CODES.NOT_FOUND, [], 'notFound'],
    [
      'rate limited with a wait',
      429,
      ERROR_CODES.RATE_LIMITED,
      [{ path: 'retryAfterSeconds', message: '20' }],
      'rateLimited',
    ],
    ['rate limited without one', 429, ERROR_CODES.RATE_LIMITED, [], 'rateLimitedPlain'],
    [
      'validation with fields',
      422,
      ERROR_CODES.VALIDATION_FAILED,
      [{ path: 'tagline', message: 'Too short' }],
      'validationFields',
    ],
    ['validation without fields', 422, ERROR_CODES.VALIDATION_FAILED, [], 'validation'],
    ['a 4xx we do not know', 400, 'SOMETHING_NEW', [], 'request'],
    ['a 5xx', 503, 'INTERNAL', [], 'unexpected'],
  ];
  for (const [name, status, code, errors, key] of cases) {
    it(`${name} -> ${key}`, () => {
      expect(marketError(api(status, code, errors)).key).toBe(key);
    });
  }

  it('carries the values the messages need', () => {
    expect(
      marketError(
        api(409, ERROR_CODES.MKT_CONNECTOR_NOT_AVAILABLE, [{ path: 'x', message: 'email_parse' }]),
      ).values,
    ).toEqual({ type: 'email_parse' });
    expect(
      marketError(
        api(409, ERROR_CODES.MKT_VERSION_EXISTS, [
          { path: 'manifest.version', message: 'higher_than:1.2.0' },
        ]),
      ).values,
    ).toEqual({ newest: '1.2.0' });
    expect(
      marketError(api(409, ERROR_CODES.MKT_VERSION_STATE, [{ path: 'status', message: 'killed' }]))
        .values,
    ).toEqual({ status: 'killed' });
    expect(
      marketError(
        api(429, ERROR_CODES.RATE_LIMITED, [{ path: 'retryAfterSeconds', message: '20' }]),
      ).values,
    ).toEqual({ seconds: '20' });
  });

  it('never shows the retry-after pseudo field as a problem', () => {
    expect(
      serverProblems(
        api(429, ERROR_CODES.RATE_LIMITED, [{ path: 'retryAfterSeconds', message: '5' }]),
      ),
    ).toEqual([]);
  });

  it('a non-API failure is an unexpected error', () => {
    expect(marketError(new TypeError('boom'))).toMatchObject({
      kind: 'general',
      key: 'unexpected',
    });
    expect(marketError(undefined).problems).toEqual([]);
  });

  it('every key it can answer is listed for the messages test, and every MKT operator code is mapped', () => {
    const answered = new Set(cases.map((c) => c[4]));
    answered.add('conflict');
    answered.add('noAccess');
    for (const key of MARKET_ERROR_KEYS) expect(answered.has(key), key).toBe(true);
    const operatorCodes = [
      'MKT_MANIFEST_INVALID',
      'MKT_RECIPE_INVALID',
      'MKT_URL_REFUSED',
      'MKT_CONNECTOR_NOT_AVAILABLE',
      'MKT_SLUG_TAKEN',
      'MKT_CATEGORY_NOT_FOUND',
      'MKT_CATEGORY_IN_USE',
      'MKT_VERSION_STATE',
      'MKT_VERSION_EXISTS',
      'MKT_APP_NOT_FOUND',
      'MKT_APP_UNAVAILABLE',
      'MKT_SUBSCRIPTION_STATE',
      'MKT_SUBSCRIPTION_NOT_FOUND',
    ] as const;
    for (const code of operatorCodes) {
      expect(marketError(api(409, ERROR_CODES[code])).key, code).not.toBe('request');
      expect(marketError(api(409, ERROR_CODES[code])).key, code).not.toBe('unexpected');
    }
  });
});
