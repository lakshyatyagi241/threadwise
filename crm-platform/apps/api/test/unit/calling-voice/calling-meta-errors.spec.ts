import { describe, expect, it } from 'vitest';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { metaReason } from '../../../src/modules/calling-voice/calling-meta-errors';
import { refused } from '../../../src/modules/calling-voice/calling-support';

const fail = (status: number, code: number | null, message: string, subcode?: number) =>
  WabaApiError.fromResponse(status, {
    error: { code: code ?? undefined, error_subcode: subcode, message },
  });

describe('metaReason', () => {
  it.each([
    [400, 141000, 'Not a cloud api number', 'coexistence'],
    [400, 138000, 'Calling is not enabled', 'calling_not_enabled'],
    [400, 138001, 'Receiver uncallable', 'receiver_uncallable'],
    [400, 138006, 'No approved call permission from this user', 'no_call_permission'],
    [400, 138009, 'Limit reached', 'permission_request_limit'],
    [400, 190, 'Error validating access token', 'token_expired'],
    [403, 10, 'Application does not have permission for this action', 'permission_scope'],
    [403, 200, 'Permissions error', 'permission_scope'],
    [400, 100, 'Calling pre-requisite not met', 'prerequisites'],
    [400, 100, 'Application does not have permission for this action', 'permission_scope'],
    [400, 100, 'Something nobody has seen before', 'unknown'],
  ] as const)('%s %s %s -> %s', (status, code, message, reason) => {
    expect(metaReason(fail(status, code, message))).toBe(reason);
  });

  it('reads the missing-management sub-code, and a network failure', () => {
    expect(metaReason(fail(400, 100, 'x', 1349174))).toBe('permission_scope');
    expect(metaReason(WabaApiError.network(new Error('down')))).toBe('meta_unreachable');
    expect(metaReason(fail(503, null, 'Service unavailable'))).toBe('meta_unreachable');
  });

  it('reads a sentence only together with code 100, never on its own', () => {
    expect(metaReason(fail(400, 131000, 'Calling pre-requisite not met'))).toBe('unknown');
    expect(metaReason(fail(400, null, 'missing permissions'))).toBe('unknown');
    expect(metaReason(fail(400, 100, 'Calling is not available in this country'))).toBe('unknown');
    expect(metaReason(fail(400, 100, 'The business needs a messaging limit of 2,000'))).toBe(
      'unknown',
    );
  });
});

describe('refused carries the reason as a problem detail', () => {
  it('on a Meta refusal, on the request limit and on a plain error', () => {
    expect(
      refused(fail(400, 138006, 'No approved call permission'), 'Meta refused the call').details,
    ).toEqual([{ path: 'reason', message: 'no_call_permission' }]);
    expect(refused(fail(400, 138009, 'Limit'), 'x').details).toEqual([
      { path: 'reason', message: 'permission_request_limit' },
    ]);
    expect(refused(new Error('boom'), 'x').details).toEqual([
      { path: 'reason', message: 'unknown' },
    ]);
  });
});
