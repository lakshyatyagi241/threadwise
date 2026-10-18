import { describe, expect, it } from 'vitest';
import {
  classifyMetaCode,
  describeMetaError,
  metaFailure,
  scrub,
} from '../../../src/infra/providers/whatsapp/meta-errors';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { graphError } from '../../fixtures/whatsapp';

/**
 * What a refusal from the Cloud API means for us: Meta's recorded error bodies, decoded by the platform's one client (`WabaApiError`),
 * through the table that gives them our vocabulary. Nothing here was produced by a live account.
 */

const fail = (status: number, body: unknown, secrets: string[] = []) =>
  metaFailure(WabaApiError.fromResponse(status, body), secrets);

describe("metaFailure: Meta's code to a decision", () => {
  const rows: Array<[fixture: string, status: number, expected: Record<string, unknown>]> = [
    ['190', 401, { code: 'CHANNEL_AUTH_EXPIRED', retryable: false, needsReauth: true }],
    ['190-463', 401, { code: 'CHANNEL_AUTH_EXPIRED', retryable: false, needsReauth: true }],
    ['10', 403, { code: 'CHANNEL_PERMISSION_DENIED', retryable: false, needsReauth: true }],
    ['200', 403, { code: 'CHANNEL_PERMISSION_DENIED', retryable: false, needsReauth: true }],
    ['131047', 400, { code: 'SERVICE_WINDOW_CLOSED', retryable: false, needsReauth: false }],
    ['131026', 400, { code: 'RECIPIENT_UNDELIVERABLE', retryable: false }],
    ['131049', 400, { code: 'ECOSYSTEM_ENGAGEMENT_BLOCKED', retryable: false }],
    ['131048', 400, { code: 'SPAM_RATE_LIMITED', retryable: true, retryAfterMs: 15 * 60_000 }],
    ['131056', 400, { code: 'PAIR_RATE_LIMITED', retryable: true, retryAfterMs: 60_000 }],
    ['130429', 429, { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 10_000 }],
    ['80007', 400, { code: 'RATE_LIMITED', retryable: true, retryAfterMs: 60_000 }],
    ['132001', 400, { code: 'TEMPLATE_MISSING', retryable: false }],
    ['132000', 400, { code: 'TEMPLATE_PARAMS_INVALID', retryable: false }],
    ['132015', 400, { code: 'TEMPLATE_PAUSED', retryable: false }],
    ['131051', 400, { code: 'UNSUPPORTED_MESSAGE_TYPE', retryable: false }],
    ['131052', 400, { code: 'MEDIA_REJECTED', retryable: false }],
    ['131000', 500, { code: 'PROVIDER_ERROR', retryable: true }],
    ['133010', 400, { code: 'NUMBER_NOT_REGISTERED', retryable: false }],
  ];

  it.each(rows)('Meta %s (HTTP %i)', (fixture, status, expected) => {
    const err = fail(status, graphError(fixture));
    expect(err).toMatchObject(expected);
    expect(err.providerCode).toBe(fixture.split('-')[0]);
  });

  it('an error Meta marks transient, or any 5xx or 429 the table has no row for, is retryable', () => {
    expect(fail(400, graphError('2-transient'))).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
    expect(fail(503, { error: { message: 'down', code: 999999 } })).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
    expect(fail(429, { error: { message: 'slow down', code: 999999 } })).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('a 401 or 403 the table has no row for is about the token; any other 4xx is a refusal that is not retried', () => {
    expect(fail(401, { error: { message: 'no', code: 999999 } })).toMatchObject({
      code: 'CHANNEL_AUTH_EXPIRED',
      needsReauth: true,
    });
    expect(fail(403, {})).toMatchObject({ code: 'CHANNEL_AUTH_EXPIRED', needsReauth: true });
    expect(fail(400, graphError('999999-unknown'))).toMatchObject({
      code: 'PROVIDER_REJECTED',
      retryable: false,
      needsReauth: false,
    });
  });

  it("a body with no error object (a proxy's HTML page, a bare string) still gets a decision from the status", () => {
    expect(
      metaFailure(WabaApiError.fromResponse(502, { raw: '<html>Bad gateway</html>' })),
    ).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
    expect(metaFailure(WabaApiError.fromResponse(404, 'nothing'))).toMatchObject({
      code: 'PROVIDER_REJECTED',
      retryable: false,
    });
  });

  const refused = () =>
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

  it('a connection that provably never left (refused, unresolved name) is retryable and says so', () => {
    const err = metaFailure(WabaApiError.network(refused()));
    expect(err).toMatchObject({
      code: 'PROVIDER_UNREACHABLE',
      retryable: true,
      retryAfterMs: 10_000,
      outcomeMayHaveCommitted: false,
    });
  });

  it('a timeout, a reset or an unknown network error may have been accepted: not retried, outcome unknown (RF-01)', () => {
    for (const cause of [
      Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }),
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
      new TypeError('fetch failed'),
    ]) {
      expect(metaFailure(WabaApiError.network(cause))).toMatchObject({
        code: 'PROVIDER_OUTCOME_UNKNOWN',
        retryable: false,
        outcomeMayHaveCommitted: true,
      });
    }
  });

  it('a 200 whose body could not be read was accepted by Meta: outcome unknown, even when the cause looks like a refusal', () => {
    expect(metaFailure(WabaApiError.network(refused(), { bodyUnreadable: true }))).toMatchObject({
      code: 'PROVIDER_OUTCOME_UNKNOWN',
      retryable: false,
    });
  });

  it("keeps Meta's own words (user message, details, code and trace) in the reason", () => {
    const err = fail(400, graphError('131047'));
    expect(err.message).toContain('more than 24 hours have passed');
    expect(err.message).toContain('#131047');
    expect(err.message).toContain('trace AbCdEfGhIj12345');
  });

  it('removes the token, a bearer header and a Graph token shape from whatever Meta echoed back', () => {
    const token = 'EAAGsecretTokenValue0123456789abcdef';
    const err = fail(
      400,
      { error: { message: `Bad token ${token} sent as Bearer ${token}`, code: 100 } },
      [token],
    );
    expect(err.message).not.toContain(token);
    expect(scrub(`Authorization: Bearer abc.def-123`, [])).toBe('Authorization: Bearer [redacted]');
    expect(scrub('EAAB' + 'x'.repeat(30), [])).toBe('[redacted]');
  });
});

describe('classifyMetaCode and describeMetaError', () => {
  it('the same table reads the error of a failed delivery status; a code with no row is null', () => {
    expect(classifyMetaCode(131047)).toMatchObject({
      code: 'SERVICE_WINDOW_CLOSED',
      retryable: false,
    });
    expect(classifyMetaCode(190, 463)).toMatchObject({ needsReauth: true });
    expect(classifyMetaCode(424242)).toBeNull();
    expect(classifyMetaCode(null)).toBeNull();
  });

  it('is total: an empty or odd error is a sentence, not an exception', () => {
    expect(describeMetaError(undefined)).toBe('Unknown Meta error');
    expect(describeMetaError({ code: 100 })).toBe('Unknown Meta error (#100)');
  });
});
