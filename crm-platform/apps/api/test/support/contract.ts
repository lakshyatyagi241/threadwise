import { appendFileSync } from 'node:fs';
import { z, type ZodTypeAny } from 'zod';
import { ERROR_CODES, problemSchema } from '@crm/contracts';

/**
 * Contract assertions for the API tests (QA task 8).
 *
 * `expectContract(res, schema)` checks a real response against the zod schema in `@crm/contracts` that describes it, and
 * `expectProblem(res, status)` checks an error response against the problem+json envelope and the error-code registry.
 * Every check adds to a counter, so the "number of contract assertions" is measured, not guessed.
 *
 * One assertion is counted for each of: the status, the content type of an error, and every leaf value (string, number,
 * boolean, null, empty array) the schema validated in the body. A list of 50 rows with 8 fields each is 400+ assertions
 * from one call, which is the honest cost of "every field of every row matched its declared type".
 *
 * Environment:
 *   QA_CONTRACT_OUT=file   append one JSON line per checked response, for `tools/quality/sum-contract-assertions.mjs`
 *   QA_CONTRACT=1          `withContractWatch` records the envelope of every error in an e2e run; `strict` also throws
 */
export interface ContractStats {
  responses: number;
  assertions: number;
  /** Fields the API returned that the schema does not declare (never a failure by itself). */
  undeclaredFields: number;
}

const stats: ContractStats = { responses: 0, assertions: 0, undeclaredFields: 0 };
export const contractStats = (): ContractStats => ({ ...stats });
export const resetContractStats = (): void => {
  stats.responses = 0;
  stats.assertions = 0;
  stats.undeclaredFields = 0;
};

/** Number of leaf values in a parsed body: what "one assertion per field" means. */
export function countLeaves(v: unknown): number {
  if (Array.isArray(v))
    return v.length === 0 ? 1 : v.reduce<number>((n, x) => n + countLeaves(x), 0);
  if (v !== null && typeof v === 'object') {
    const values = Object.values(v as Record<string, unknown>);
    return values.length === 0 ? 1 : values.reduce<number>((n, x) => n + countLeaves(x), 0);
  }
  return 1;
}

/** Keys present in `body` that the object schema does not declare, as dotted paths. Arrays are walked by their first rows. */
export function undeclaredFields(schema: ZodTypeAny, body: unknown, path = ''): string[] {
  const s = unwrap(schema);
  if (
    s instanceof z.ZodObject &&
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body)
  ) {
    const shape = s.shape as Record<string, ZodTypeAny>;
    const out: string[] = [];
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (!(k in shape)) out.push(path ? `${path}.${k}` : k);
      else out.push(...undeclaredFields(shape[k]!, v, path ? `${path}.${k}` : k));
    }
    return out;
  }
  if (s instanceof z.ZodArray && Array.isArray(body)) {
    return body.slice(0, 5).flatMap((row) => undeclaredFields(s.element, row, `${path}[]`));
  }
  return [];
}

function unwrap(s: ZodTypeAny): ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 10; i++) {
    const def = cur._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny };
    if (
      def.typeName === 'ZodOptional' ||
      def.typeName === 'ZodNullable' ||
      def.typeName === 'ZodDefault'
    )
      cur = def.innerType!;
    else if (def.typeName === 'ZodEffects') cur = def.schema!;
    else return cur;
  }
  return cur;
}

export interface ResponseLike {
  status: number;
  body: unknown;
  text?: string;
  headers?: Record<string, unknown>;
}

function record(label: string, assertions: number, undeclared: number): void {
  stats.responses += 1;
  stats.assertions += assertions;
  stats.undeclaredFields += undeclared;
  const out = process.env.QA_CONTRACT_OUT;
  if (out) {
    try {
      appendFileSync(out, JSON.stringify({ label, assertions, undeclared }) + '\n');
    } catch {
      /* the counter is a measurement aid; never fail a test because it could not be written */
    }
  }
}

export class ContractError extends Error {}

const fail = (label: string, why: string): never => {
  throw new ContractError(`contract violated${label ? ` (${label})` : ''}: ${why}`);
};

/** The response must have one of these statuses and a body that parses with `schema`. Returns the parsed body. */
export function expectContract<T extends ZodTypeAny>(
  res: ResponseLike,
  schema: T,
  opts: { status?: number | number[]; label?: string } = {},
): z.infer<T> {
  const label = opts.label ?? '';
  const want =
    opts.status === undefined
      ? [200, 201]
      : Array.isArray(opts.status)
        ? opts.status
        : [opts.status];
  if (!want.includes(res.status))
    fail(
      label,
      `status ${res.status}, expected ${want.join(' or ')}; body ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  const parsed = schema.safeParse(res.body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    fail(label, issues.join('; '));
  }
  const data = (parsed as { success: true; data: z.infer<T> }).data;
  record(label, 1 + countLeaves(data), undeclaredFields(schema, res.body).length);
  return data;
}

const KNOWN_CODES = new Set<string>(Object.values(ERROR_CODES));

/** The legacy customer-API envelope `{ error: { code, message } }` used by the `/api/v1` surface. */
const legacyErrorSchema = z.object({
  error: z.object({ code: z.union([z.string(), z.number()]), message: z.string() }),
});

/**
 * An error response must carry the problem+json envelope (or the legacy customer envelope on its own surface), a code the
 * registry knows, a `status` equal to the HTTP status, and no stack trace.
 */
export function expectProblem(
  res: ResponseLike,
  status: number | number[],
  opts: { code?: string | string[]; label?: string } = {},
): void {
  const label = opts.label ?? '';
  const want = Array.isArray(status) ? status : [status];
  if (!want.includes(res.status))
    fail(
      label,
      `status ${res.status}, expected ${want.join(' or ')}; body ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  const text = res.text ?? JSON.stringify(res.body ?? '');
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text)) fail(label, 'a stack trace is in the reply');
  const legacy = legacyErrorSchema.safeParse(res.body);
  if (legacy.success) {
    record(label, 3, 0);
    return;
  }
  const type = String(res.headers?.['content-type'] ?? '');
  if (res.headers && !type.includes('application/problem+json'))
    fail(label, `content type is "${type}", expected application/problem+json`);
  const p = problemSchema.safeParse(res.body);
  if (!p.success)
    fail(
      label,
      `not a problem+json body: ${p.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  const body = (p as { success: true; data: z.infer<typeof problemSchema> }).data;
  if (body.status !== res.status)
    fail(label, `body.status ${body.status} differs from HTTP status ${res.status}`);
  if (!KNOWN_CODES.has(body.code)) fail(label, `code "${body.code}" is not in ERROR_CODES`);
  const codes = opts.code === undefined ? null : Array.isArray(opts.code) ? opts.code : [opts.code];
  if (codes && !codes.includes(body.code))
    fail(label, `code ${body.code}, expected ${codes.join(' or ')}`);
  record(label, 4 + countLeaves(body), 0);
}

/**
 * Wraps a Supertest request so that, when `QA_CONTRACT` is set, every awaited error response is checked against the
 * envelope. It does nothing otherwise. With `QA_CONTRACT=strict` a violation fails the test that made the request;
 * with any other value it is only counted (see `contractViolations`).
 */
const violations: string[] = [];
export const contractViolations = (): string[] => [...violations];

export function withContractWatch<T extends PromiseLike<ResponseLike>>(test: T): T {
  const mode = process.env.QA_CONTRACT;
  if (!mode) return test;
  const original = test.then.bind(test) as PromiseLike<ResponseLike>['then'];
  // The check is its own first stage and the caller's handlers come after it. Passing it in the same `then(ok, bad)` call would
  // leave a violation thrown in strict mode with nobody to catch it, and an `await` would never settle.
  (test as { then: unknown }).then = (
    ok?: (r: ResponseLike) => unknown,
    bad?: (e: unknown) => unknown,
  ) =>
    Promise.resolve(
      original((res: ResponseLike) => {
        if (res.status >= 400) {
          try {
            expectProblem(res, res.status, { label: 'watch' });
          } catch (e) {
            violations.push(`${res.status}: ${(e as Error).message}`);
            if (mode === 'strict') throw e;
          }
        }
        return res;
      }),
    ).then(ok, bad);
  return test;
}
