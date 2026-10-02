import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProblemExceptionFilter } from '../../../src/common/filters/problem-exception.filter';

/** Runs the filter against a fake response and returns what it sent. */
function run(exception: unknown) {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    type() {
      return this;
    },
    send(body: Record<string, unknown>) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/v2/x' }) }),
  } as unknown as ArgumentsHost;
  new ProblemExceptionFilter().catch(exception, host);
  return sent;
}

/** The shape body-parser (http-errors) throws before Nest routes the request. */
const bodyParserError = (type: string, status: number) =>
  Object.assign(new Error(type), { type, status, statusCode: status, expose: true });

describe('ProblemExceptionFilter body-parser errors', () => {
  it('answers 413 PAYLOAD_TOO_LARGE for an oversized body, not 500', () => {
    const { status, body } = run(bodyParserError('entity.too.large', 413));
    expect(status).toBe(413);
    expect(body).toMatchObject({
      status: 413,
      title: 'Payload Too Large',
      code: 'PAYLOAD_TOO_LARGE',
      detail: 'The request body is too large.',
    });
  });

  it('answers 400 for JSON that cannot be parsed', () => {
    const { status, body } = run(bodyParserError('entity.parse.failed', 400));
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('still answers 500 without leaking details for an unknown error', () => {
    const { status, body } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'INTERNAL', detail: 'An unexpected error occurred.' });
  });

  it('does not treat an arbitrary object with status 413 as a body-parser error', () => {
    const { status } = run({ status: 413 });
    expect(status).toBe(500);
  });
});
