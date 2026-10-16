import { describe, expect, it } from 'vitest';
import { ERROR_CODES, PLAN_UPGRADE_PATH } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { LEAD_DETAIL_CODES, LEAD_ERROR_KEYS, detailIssue, issuesByPath, leadError } from './errors';

const MLA_CODES = [
  ERROR_CODES.MLA_NOT_CONFIGURED,
  ERROR_CODES.MLA_LEAD_ACCESS_MISSING,
  ERROR_CODES.MLA_PAGE_RECONNECT,
  ERROR_CODES.MLA_SUBSCRIBE_FAILED,
  ERROR_CODES.MLA_FORMS_UNAVAILABLE,
  ERROR_CODES.MLA_FORM_NOT_FOUND,
  ERROR_CODES.MLA_SYNC_OFF,
];

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

  it('translates the detail codes of the first-message setting', () => {
    const e = leadError(
      err(422, ERROR_CODES.LEAD_DEFAULTS_INVALID, [
        { path: 'defaults.speedToLead.templateId', message: 'template_not_found' },
        { path: 'defaults.speedToLead.senderId', message: 'sender_not_found' },
      ]),
    );
    expect(e.issues).toEqual([
      { path: 'defaults.speedToLead.templateId', key: 'details.template_not_found' },
      { path: 'defaults.speedToLead.senderId', key: 'details.sender_not_found' },
    ]);
  });

  it('says how long to wait when a source was asked too soon, and what is wrong with a pull', () => {
    expect(
      leadError(
        err(429, ERROR_CODES.LEAD_SYNC_TOO_SOON, [{ path: 'retryAfterSeconds', message: '42' }]),
      ),
    ).toMatchObject({ key: 'syncTooSoon', values: { seconds: '42' } });
    expect(leadError(err(429, ERROR_CODES.LEAD_SYNC_TOO_SOON)).key).toBe('syncTooSoonNoWait');
    expect(leadError(err(409, ERROR_CODES.LEAD_SYNC_IN_PROGRESS)).key).toBe('syncInProgress');
    expect(leadError(err(409, ERROR_CODES.LEAD_SYNC_NOT_SUPPORTED)).key).toBe('syncNotSupported');
    expect(leadError(err(422, ERROR_CODES.LEAD_BACKFILL_RANGE_INVALID)).key).toBe('backfillRange');
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
      err(409, ERROR_CODES.LEAD_SYNC_NOT_SUPPORTED),
      err(409, ERROR_CODES.LEAD_SYNC_IN_PROGRESS),
      err(429, ERROR_CODES.LEAD_SYNC_TOO_SOON),
      err(422, ERROR_CODES.LEAD_BACKFILL_RANGE_INVALID),
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
      ...MLA_CODES.map((code) => err(422, code)),
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

describe('leadError: Meta lead ads codes', () => {
  it('maps each MLA code to the way out the screen offers', () => {
    const kinds = Object.fromEntries(
      MLA_CODES.map((code) => [
        code,
        [leadError(err(422, code)).kind, leadError(err(422, code)).key],
      ]),
    );
    expect(kinds).toEqual({
      MLA_NOT_CONFIGURED: ['general', 'mlaNotConfigured'],
      MLA_LEAD_ACCESS_MISSING: ['grantAccess', 'mlaLeadAccessMissing'],
      MLA_PAGE_RECONNECT: ['reconnect', 'mlaPageReconnect'],
      MLA_SUBSCRIBE_FAILED: ['metaRetry', 'mlaSubscribeFailed'],
      MLA_FORMS_UNAVAILABLE: ['metaRetry', 'mlaFormsUnavailable'],
      MLA_FORM_NOT_FOUND: ['metaRetry', 'mlaFormNotFound'],
      MLA_SYNC_OFF: ['syncOff', 'mlaSyncOff'],
    });
  });

  it('carries Meta words only for the two refusals that hold them, cut short', () => {
    const long = new ApiError(422, ERROR_CODES.MLA_FORMS_UNAVAILABLE, 'x'.repeat(500), 'req-2');
    expect(leadError(long).metaSaid).toHaveLength(300);
    const sub = new ApiError(422, ERROR_CODES.MLA_SUBSCRIBE_FAILED, 'Meta said no', 'req-3');
    expect(leadError(sub).metaSaid).toBe('Meta said no');
    expect(leadError(err(422, ERROR_CODES.MLA_LEAD_ACCESS_MISSING)).metaSaid).toBeUndefined();
    expect(leadError(err(422, ERROR_CODES.MLA_PAGE_RECONNECT)).metaSaid).toBeUndefined();
    expect(
      leadError(new ApiError(422, ERROR_CODES.MLA_SUBSCRIBE_FAILED, '  ')).metaSaid,
    ).toBeUndefined();
  });

  it('still answers a plan that lacks the Facebook channel as a locked plan', () => {
    expect(leadError(err(422, ERROR_CODES.PLAN_FEATURE_LOCKED)).kind).toBe('locked');
  });
});
