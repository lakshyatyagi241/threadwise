import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  ContractError,
  contractStats,
  contractViolations,
  countLeaves,
  expectContract,
  expectProblem,
  resetContractStats,
  undeclaredFields,
  withContractWatch,
} from '../../support/contract';

const tag = z.object({ id: z.string().uuid(), name: z.string(), color: z.string().nullable() });
const ID = '11111111-1111-4111-8111-111111111111';
const problem = (status: number, code: string, extra: object = {}) => ({
  status,
  body: { type: 'about:blank', title: 'x', status, code, ...extra },
  headers: { 'content-type': 'application/problem+json; charset=utf-8' },
});

afterEach(() => {
  resetContractStats();
  vi.unstubAllEnvs();
});

describe('countLeaves', () => {
  it('counts every value, and an empty array or object as one', () => {
    expect(countLeaves({ a: 1, b: 'x', c: null })).toBe(3);
    expect(
      countLeaves({
        rows: [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
        ],
        page: { next: null },
      }),
    ).toBe(5);
    expect(countLeaves({ rows: [], meta: {} })).toBe(2);
    expect(countLeaves('x')).toBe(1);
  });
});

describe('expectContract', () => {
  it('returns the parsed body and counts the status plus every field', () => {
    const out = expectContract({ status: 201, body: { id: ID, name: 'A', color: null } }, tag, {
      status: 201,
    });
    expect(out.name).toBe('A');
    expect(contractStats()).toEqual({ responses: 1, assertions: 4, undeclaredFields: 0 });
  });
  it('fails with the field path when a type is wrong', () => {
    expect(() =>
      expectContract({ status: 200, body: { id: 'nope', name: 1, color: null } }, tag, {
        label: 'GET /v2/tags',
      }),
    ).toThrow(/GET \/v2\/tags.*id: Invalid uuid/);
    expect(contractStats().responses).toBe(0);
  });
  it('fails on an unexpected status and shows the body', () => {
    expect(() => expectContract({ status: 500, body: { code: 'INTERNAL' } }, tag)).toThrow(
      /status 500, expected 200 or 201.*INTERNAL/,
    );
    expect(() => expectContract({ status: 404, body: {} }, tag, { status: [200, 404] })).toThrow(
      ContractError,
    );
  });
  it('counts, but does not fail on, fields the schema does not declare', () => {
    expectContract({ status: 200, body: { id: ID, name: 'A', color: null, secret: 1 } }, tag);
    expect(contractStats().undeclaredFields).toBe(1);
  });
});

describe('undeclaredFields', () => {
  it('walks nested objects and the first rows of a list', () => {
    const s = z.object({
      data: z.array(z.object({ id: z.string() })),
      page: z.object({ limit: z.number() }),
    });
    expect(
      undeclaredFields(s, { data: [{ id: 'a', extra: 1 }], page: { limit: 1, more: true } }),
    ).toEqual(['data[].extra', 'page.more']);
  });
});

describe('expectProblem', () => {
  it('accepts a well-formed problem+json with a known code', () => {
    expect(() =>
      expectProblem(problem(404, 'NOT_FOUND'), 404, { code: 'NOT_FOUND' }),
    ).not.toThrow();
    expect(contractStats().assertions).toBeGreaterThanOrEqual(8);
  });
  it('refuses a wrong status, an unknown code, a mismatched body status and a stack trace', () => {
    expect(() => expectProblem(problem(404, 'NOT_FOUND'), 403)).toThrow(/status 404, expected 403/);
    expect(() => expectProblem(problem(400, 'MADE_UP_CODE'), 400)).toThrow(/not in ERROR_CODES/);
    expect(() =>
      expectProblem(
        {
          ...problem(400, 'VALIDATION_FAILED'),
          body: { type: 'a', title: 'b', status: 422, code: 'VALIDATION_FAILED' },
        },
        400,
      ),
    ).toThrow(/differs from HTTP status/);
    expect(() =>
      expectProblem(
        { ...problem(500, 'INTERNAL'), text: 'Error\n    at run (/app/src/x.ts:10:5)' },
        500,
      ),
    ).toThrow(/stack trace/);
  });
  it('refuses a plain JSON error and a wrong content type', () => {
    expect(() =>
      expectProblem(
        { status: 400, body: { message: 'bad' }, headers: { 'content-type': 'application/json' } },
        400,
      ),
    ).toThrow(/content type|not a problem/);
    expect(() =>
      expectProblem(
        { ...problem(400, 'VALIDATION_FAILED'), headers: { 'content-type': 'application/json' } },
        400,
      ),
    ).toThrow(/content type/);
  });
  it('checks the expected code when one is given', () => {
    expect(() =>
      expectProblem(problem(409, 'CONFLICT'), 409, { code: ['ROW_VERSION_CONFLICT'] }),
    ).toThrow(/code CONFLICT, expected ROW_VERSION_CONFLICT/);
  });
  it('accepts the legacy customer envelope on its own surface', () => {
    expect(() =>
      expectProblem(
        { status: 401, body: { error: { code: 'API_KEY_INVALID', message: 'bad key' } } },
        401,
      ),
    ).not.toThrow();
  });
});

describe('withContractWatch', () => {
  const app = express();
  app.get('/ok', (_q, r) => r.json({ ok: true }));
  app.get('/good-error', (_q, r) => {
    r.status(404).setHeader('content-type', 'application/problem+json; charset=utf-8');
    r.end(
      JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, code: 'NOT_FOUND' }),
    );
  });
  app.get('/bad-error', (_q, r) => r.status(400).json({ message: 'plain' }));

  it('does nothing unless QA_CONTRACT is set', async () => {
    const res = await withContractWatch(request(app).get('/bad-error'));
    expect(res.status).toBe(400);
    expect(contractViolations()).toEqual([]);
  });
  it('records a violation in record mode and lets the test continue', async () => {
    vi.stubEnv('QA_CONTRACT', '1');
    const before = contractViolations().length;
    const res = await withContractWatch(request(app).get('/bad-error'));
    expect(res.status).toBe(400);
    expect(contractViolations().length).toBe(before + 1);
  });
  it('throws in strict mode, and passes a good error and a success untouched', async () => {
    vi.stubEnv('QA_CONTRACT', 'strict');
    await expect(withContractWatch(request(app).get('/bad-error'))).rejects.toThrow(
      /contract violated/,
    );
    expect((await withContractWatch(request(app).get('/good-error'))).status).toBe(404);
    expect((await withContractWatch(request(app).get('/ok'))).status).toBe(200);
  });
});
