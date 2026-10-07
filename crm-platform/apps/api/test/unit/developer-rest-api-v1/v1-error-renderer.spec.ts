import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type Problem } from '@crm/contracts';
import {
  snakeSegment,
  toV1Error,
} from '../../../src/modules/developer-rest-api-v1/http/v1-error-renderer';

const problem = (over: Partial<Problem>): Problem => ({
  type: 'about:blank',
  title: 'x',
  status: 400,
  code: ERROR_CODES.VALIDATION_FAILED,
  ...over,
});

describe('v1 error envelope (WD-API-007)', () => {
  it('wraps a missing key as 401 missing_api_key with the requestId', () => {
    const { status, body } = toV1Error(
      problem({
        status: 401,
        code: ERROR_CODES.UNAUTHENTICATED,
        detail: 'No API key provided.',
        requestId: 'r-1',
      }),
    );
    expect(status).toBe(401);
    expect(body).toEqual({
      error: { code: 'missing_api_key', message: 'No API key provided.', requestId: 'r-1' },
    });
  });

  it('maps the stable codes to WaDesk snake_case', () => {
    const code = (c: string, status = 400) =>
      toV1Error(problem({ code: c, status })).body.error.code;
    expect(code(ERROR_CODES.API_KEY_INVALID, 401)).toBe('invalid_api_key');
    expect(code(ERROR_CODES.RATE_LIMITED, 429)).toBe('rate_limited');
    expect(code(ERROR_CODES.NOT_FOUND, 404)).toBe('not_found');
    expect(code(ERROR_CODES.FORBIDDEN, 403)).toBe('forbidden');
    expect(code(ERROR_CODES.INTERNAL, 500)).toBe('server_error');
    expect(code(ERROR_CODES.ROW_VERSION_CONFLICT, 409)).toBe('conflict');
  });

  it('always answers validation with 422 and groups the messages per field', () => {
    const { status, body } = toV1Error(
      problem({
        status: 400,
        errors: [
          { path: 'phone', message: 'Required' },
          { path: 'phone', message: 'Too short' },
          { path: 'group_ids.0', message: 'Unknown group' },
        ],
      }),
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual({
      phone: ['Required', 'Too short'],
      'group_ids.0': ['Unknown group'],
    });
  });

  it('turns the plan problems into WaDesk statuses: 403 plan_feature_disabled, 402 plan_limit', () => {
    expect(
      toV1Error(problem({ code: ERROR_CODES.PLAN_FEATURE_LOCKED, status: 422 })),
    ).toMatchObject({
      status: 403,
      body: { error: { code: 'plan_feature_disabled' } },
    });
    expect(toV1Error(problem({ code: ERROR_CODES.PLAN_LIMIT_REACHED, status: 422 }))).toMatchObject(
      {
        status: 402,
        body: { error: { code: 'plan_limit' } },
      },
    );
  });

  it('lower-cases a delegated domain code and keeps its status', () => {
    expect(toV1Error(problem({ code: 'FLR_FLOW_INACTIVE', status: 422 }))).toMatchObject({
      status: 422,
      body: { error: { code: 'flr_flow_inactive' } },
    });
  });

  it('leaves out details and requestId when there are none', () => {
    const { body } = toV1Error(
      problem({ status: 404, code: ERROR_CODES.NOT_FOUND, detail: 'Contact not found' }),
    );
    expect(Object.keys(body.error)).toEqual(['code', 'message']);
  });

  it('writes validation paths in the snake_case the client sent', () => {
    const { body } = toV1Error(
      problem({
        errors: [
          { path: 'ownerId', message: 'Unknown member' },
          { path: 'customFields.collegeTag', message: 'x' },
          { path: 'group_ids.0', message: 'Unknown group' },
        ],
      }),
    );
    expect(Object.keys(body.error.details ?? {})).toEqual([
      'owner_id',
      'custom_fields.college_tag',
      'group_ids.0',
    ]);
    expect(snakeSegment('rowVersion')).toBe('row_version');
    expect(snakeSegment('already_snake')).toBe('already_snake');
    expect(snakeSegment('0')).toBe('0');
  });

  it('answers a known path called with another method as 405 with the methods that work (WaDesk)', () => {
    const { status, body } = toV1Error(
      problem({ status: 404, code: ERROR_CODES.NOT_FOUND, detail: 'Cannot DELETE /api/v1/me' }),
      ['GET'],
      'DELETE',
      '/api/v1/me',
    );
    expect(status).toBe(405);
    expect(body.error.code).toBe('method_not_allowed');
    expect(body.error.message).toBe(
      'The DELETE method is not supported for route api/v1/me. Supported methods: GET.',
    );
    expect(
      toV1Error(problem({ status: 404, code: ERROR_CODES.NOT_FOUND }), [], 'GET', '/api/v1/nope')
        .status,
    ).toBe(404);
  });
});
