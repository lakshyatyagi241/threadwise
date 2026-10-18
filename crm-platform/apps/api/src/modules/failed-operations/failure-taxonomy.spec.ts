import { describe, expect, it } from 'vitest';
import { classifyFailure, initialStatus } from './failure-taxonomy';

const facts = (message: string, over: Partial<Parameters<typeof classifyFailure>[0]> = {}) => ({
  errorMessage: message,
  unrecoverable: false,
  attemptsMade: 10,
  maxAttempts: 10,
  ...over,
});

describe('classifyFailure', () => {
  it('a payload that will not parse is a poison message', () => {
    expect(
      classifyFailure(facts('Malformed ingest job: x', { unrecoverable: true, attemptsMade: 1 })),
    ).toEqual({
      category: 'POISON_MESSAGE',
      code: 'PAYLOAD_INVALID',
    });
    expect(
      classifyFailure(facts('WhatsApp ingest payload could not be opened', { unrecoverable: true }))
        .category,
    ).toBe('POISON_MESSAGE');
  });

  it('any other unrecoverable failure is permanent', () => {
    expect(classifyFailure(facts('contact is blocked', { unrecoverable: true }))).toEqual({
      category: 'PERMANENT',
      code: 'UNRECOVERABLE',
    });
  });

  it('a stalled job is ambiguous: how far it got is not known', () => {
    expect(classifyFailure(facts('job stalled more than allowable limit'))).toEqual({
      category: 'AMBIGUOUS',
      code: 'JOB_STALLED',
    });
  });

  it.each([
    ['connect ECONNREFUSED 127.0.0.1:5432', 'INFRASTRUCTURE', 'DEPENDENCY_UNAVAILABLE'],
    ['Connection terminated unexpectedly', 'INFRASTRUCTURE', 'DEPENDENCY_UNAVAILABLE'],
    ['HTTP 429 Too Many Requests', 'RATE_LIMITED', 'RATE_LIMITED'],
    ['Graph API 401 invalid token', 'AUTHORIZATION', 'CREDENTIALS_REJECTED'],
  ])('%s', (msg, category, code) => {
    expect(classifyFailure(facts(msg))).toEqual({ category, code });
  });

  it('an error that matches nothing is transient but never retried by itself', () => {
    expect(classifyFailure(facts('something odd'))).toEqual({
      category: 'TRANSIENT',
      code: 'RETRY_EXHAUSTED',
    });
  });

  it('classifies by the wording of the message only through fixed patterns, so a reworded message lands in the same code', () => {
    expect(classifyFailure(facts('upstream returned 429')).code).toBe(
      classifyFailure(facts('rate limit hit')).code,
    );
  });
});

describe('initialStatus', () => {
  it.each(['PERMANENT', 'VALIDATION', 'AUTHORIZATION', 'POISON_MESSAGE'] as const)(
    '%s starts BLOCKED',
    (c) => {
      expect(initialStatus(c, true)).toBe('BLOCKED');
    },
  );

  it.each(['TRANSIENT', 'RATE_LIMITED', 'INFRASTRUCTURE'] as const)('%s starts OPEN', (c) => {
    expect(initialStatus(c, false)).toBe('OPEN');
  });

  it('an ambiguous outcome needs reconciliation unless the consumer is idempotent', () => {
    expect(initialStatus('AMBIGUOUS', false)).toBe('RECONCILIATION_REQUIRED');
    expect(initialStatus('AMBIGUOUS', true)).toBe('OPEN');
  });
});
