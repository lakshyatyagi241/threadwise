import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PLAN_UPGRADE_PATH } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { LEAD_DETAIL_CODES, LEAD_ERROR_KEYS, detailIssue, issuesByPath, leadError } from './errors';

const err = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that must never be shown', 'req-1', fieldErrors);

describe('leadError', () => {
  it('maps a duplicate name to a field error on name', () => {
    const e = leadError(err(409, ERROR_CODES.LEAD_SOURCE_NAME_TAKEN));
    expect(e).toMatchObject({ kind: 'field', key: 'nameTaken', field: 'name', requestId: 'req-1' });
    expect(e.issues).toEqual([{ path: 'name', key: 'nameTaken' }]);
  });

  it('turns the API detail codes of an invalid mapping into translated field issues', () => {
    const e = leadError(
      err(422, ERROR_CODES.LEAD_MAPPING_INVALID, [
        { path: 'mapping.customFields.budget', message: 'unknown_property' },
        { path: 'mapping.customFields.score', message: 'not_mappable' },
      ]),
    );
    expect(e.kind).toBe('field');
    expect(e.key).toBe('mappingInvalid');
    expect(e.issues.map((i) => [i.path, i.key])).toEqual([
      ['mapping.customFields.budget', 'details.unknown_property'],
      ['mapping.customFields.score', 'details.not_mappable'],
    ]);
  });

  it('turns the detail codes of invalid defaults into translated issues, ignoring the id after a colon', () => {
    const e = leadError(
      err(422, ERROR_CODES.LEAD_DEFAULTS_INVALID, [
        { path: 'defaults.owner.userIds', message: 'unknown_or_inactive_user:5c1e0000' },
        { path: 'defaults.deal.stageId', message: 'stage_not_in_pipeline' },
        { path: 'defaults.lifecycleStage', message: 'unknown_or_lost_stage' },
        { path: 'defaults.deal.pipelineId', message: 'something_new' },
      ]),
    );
    expect(e.key).toBe('defaultsInvalid');
    expect(e.issues.map((i) => i.key)).toEqual([
      'details.unknown_or_inactive_user',
      'details.stage_not_in_pipeline',
      'details.unknown_or_lost_stage',
      'detailVerbatim',
    ]);
    expect(e.issues[3]!.values).toEqual({ message: 'something_new' });
  });

  it('knows every detail code it can translate', () => {
    for (const code of LEAD_DETAIL_CODES)
      expect(detailIssue('p', code).key).toBe(`details.${code}`);
  });

  it('maps the retry and test refusals to their own messages', () => {
    expect(leadError(err(409, ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE)).key).toBe('notRetryable');
    expect(leadError(err(409, ERROR_CODES.LEAD_PAYLOAD_PURGED)).key).toBe('payloadPurged');
    expect(leadError(err(409, ERROR_CODES.LEAD_SOURCE_PAUSED)).key).toBe('sourcePaused');
  });

  it('answers a locked plan with the upgrade link and the feature, and keeps only a same-site link', () => {
    const e = leadError(
      err(422, ERROR_CODES.PLAN_FEATURE_LOCKED, [
        { path: 'feature', message: 'lead_sources' },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]),
    );
    expect(e).toMatchObject({
      kind: 'locked',
      key: 'planLocked',
      feature: 'lead_sources',
      upgradeUrl: '/account/plans',
    });
    const evil = leadError(
      err(422, ERROR_CODES.PLAN_FEATURE_LOCKED, [
        { path: 'upgradeUrl', message: 'https://evil.example/pay' },
      ]),
    );
    expect(evil.upgradeUrl).toBe(PLAN_UPGRADE_PATH);
    const bare = leadError(err(422, ERROR_CODES.PLAN_FEATURE_LOCKED));
    expect(bare.upgradeUrl).toBe(PLAN_UPGRADE_PATH);
  });

  it('answers a reached quota as a plan limit, not as a field error', () => {
    const e = leadError(
      err(422, ERROR_CODES.PLAN_LIMIT_REACHED, [{ path: 'upgradeUrl', message: '/account/plans' }]),
    );
    expect(e).toMatchObject({ kind: 'planLimit', key: 'planLimit', upgradeUrl: '/account/plans' });
  });

  it('says how many of the plan are used when the problem carries both numbers (BL-061)', () => {
    const e = leadError(
      err(422, ERROR_CODES.PLAN_LIMIT_REACHED, [
        { path: 'limit', message: 'lead_sources' },
        { path: 'used', message: '5' },
        { path: 'limitValue', message: '5' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]),
    );
    expect(e).toMatchObject({
      kind: 'planLimit',
      key: 'planLimitUsed',
      values: { used: '5', limit: '5' },
    });
    // none of the plan's own details is a problem with a form field
    expect(e.issues).toEqual([]);
  });

  it('falls back to the plain plan message when a number is missing or not a whole number', () => {
    for (const details of [
      [{ path: 'used', message: '5' }],
      [{ path: 'limitValue', message: '5' }],
      [
        { path: 'used', message: 'five' },
        { path: 'limitValue', message: '5' },
      ],
      [
        { path: 'used', message: '2' },
        { path: 'limitValue', message: '0' },
      ],
    ]) {
      expect(leadError(err(422, ERROR_CODES.PLAN_LIMIT_REACHED, details)).key).toBe('planLimit');
    }
  });

  it('asks for a reload on a row version conflict', () => {
    expect(leadError(err(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toMatchObject({
      kind: 'conflict',
      key: 'conflict',
    });
  });

  it('keeps the contract messages of a validation failure as field issues', () => {
    const e = leadError(
      err(422, ERROR_CODES.VALIDATION_FAILED, [
        { path: 'defaults.owner.userIds', message: 'round robin needs at least two users' },
      ]),
    );
    expect(e).toMatchObject({ kind: 'field', key: 'validation' });
    expect(e.issues[0]).toEqual({
      path: 'defaults.owner.userIds',
      key: 'validationField',
      values: { message: 'round robin needs at least two users' },
    });
    expect(leadError(err(422, ERROR_CODES.VALIDATION_FAILED))).toMatchObject({
      kind: 'general',
      key: 'validation',
    });
  });

  it('says how long to wait when the server said so', () => {
    const e = leadError(
      err(429, ERROR_CODES.RATE_LIMITED, [{ path: 'retryAfterSeconds', message: '12' }]),
    );
    expect(e).toMatchObject({ key: 'rateLimitedWait', values: { seconds: '12' } });
    expect(leadError(err(429, ERROR_CODES.RATE_LIMITED)).key).toBe('rateLimited');
  });

  it('maps not found, forbidden and signed-out', () => {
    expect(leadError(err(404, ERROR_CODES.NOT_FOUND))).toMatchObject({ kind: 'notFound' });
    expect(leadError(err(403, ERROR_CODES.FORBIDDEN))).toMatchObject({ kind: 'noAccess' });
    expect(leadError(err(401, ERROR_CODES.UNAUTHENTICATED))).toMatchObject({ kind: 'signedOut' });
  });

  it('falls back by status, never by the message text', () => {
    expect(leadError(err(500, 'INTERNAL')).key).toBe('unexpected');
    expect(leadError(err(400, 'SOMETHING_ELSE')).key).toBe('request');
    expect(leadError(new TypeError('fetch failed')).key).toBe('network');
    const zod = new Error('bad shape');
    zod.name = 'ZodError';
    expect(leadError(zod).key).toBe('badResponse');
  });

  it('never returns a key outside the list the messages test checks', () => {
    const all = [
      err(409, ERROR_CODES.LEAD_SOURCE_NAME_TAKEN),
      err(422, ERROR_CODES.LEAD_MAPPING_INVALID),
      err(422, ERROR_CODES.LEAD_DEFAULTS_INVALID),
      err(409, ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE),
      err(409, ERROR_CODES.LEAD_PAYLOAD_PURGED),
      err(409, ERROR_CODES.LEAD_SOURCE_PAUSED),
      err(422, ERROR_CODES.PLAN_FEATURE_LOCKED),
      err(422, ERROR_CODES.PLAN_LIMIT_REACHED),
      err(409, ERROR_CODES.ROW_VERSION_CONFLICT),
      err(422, ERROR_CODES.VALIDATION_FAILED),
      err(429, ERROR_CODES.RATE_LIMITED),
      err(404, ERROR_CODES.NOT_FOUND),
      err(403, ERROR_CODES.FORBIDDEN),
      err(401, ERROR_CODES.UNAUTHENTICATED),
      err(500, 'INTERNAL'),
      err(400, 'OTHER'),
      new Error('x'),
    ];
    for (const e of all) expect(LEAD_ERROR_KEYS as readonly string[]).toContain(leadError(e).key);
  });

  it('lists the first issue of each path for a form', () => {
    const e = leadError(
      err(422, ERROR_CODES.VALIDATION_FAILED, [
        { path: 'name', message: 'a' },
        { path: 'name', message: 'b' },
        { path: 'secret', message: 'c' },
      ]),
    );
    const by = issuesByPath(e);
    expect(Object.keys(by)).toEqual(['name', 'secret']);
    expect(by.name!.values).toEqual({ message: 'a' });
    expect(issuesByPath(null)).toEqual({});
  });
});
