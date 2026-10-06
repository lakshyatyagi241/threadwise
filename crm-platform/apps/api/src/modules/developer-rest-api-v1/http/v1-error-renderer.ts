import type { Request, Response } from 'express';
import { ERROR_CODES, V1_ERROR_CODES, type Problem, type V1Error } from '@crm/contracts';
import type { ProblemRenderer } from '../../../common/filters/problem-exception.filter';

/** Every route this domain serves lives under here (`VERSION_NEUTRAL`, so no `/v2` in front). */
export const V1_PATH_PREFIX = '/api/v1';

/**
 * Our problem codes to WaDesk's snake_case envelope codes (WD-API-007). A code with no entry is lower-cased, so a delegated domain's
 * `FLR_FLOW_INACTIVE` reaches the client as `flr_flow_inactive`, stable and greppable.
 */
const CODE_MAP: Record<string, { code: string; status?: number }> = {
  [ERROR_CODES.UNAUTHENTICATED]: { code: V1_ERROR_CODES.MISSING_API_KEY },
  [ERROR_CODES.API_KEY_INVALID]: { code: V1_ERROR_CODES.INVALID_API_KEY },
  [ERROR_CODES.RATE_LIMITED]: { code: V1_ERROR_CODES.RATE_LIMITED },
  [ERROR_CODES.NOT_FOUND]: { code: V1_ERROR_CODES.NOT_FOUND },
  [ERROR_CODES.VALIDATION_FAILED]: { code: V1_ERROR_CODES.VALIDATION_FAILED, status: 422 },
  // WaDesk's one code for a well-formed request that cannot be applied; the reason stays in `message`.
  [ERROR_CODES.DEAL_STAGE_MISMATCH]: { code: V1_ERROR_CODES.UNPROCESSABLE, status: 422 },
  [ERROR_CODES.DEAL_NO_OPEN_STAGE]: { code: V1_ERROR_CODES.UNPROCESSABLE, status: 422 },
  [ERROR_CODES.FORBIDDEN]: { code: V1_ERROR_CODES.FORBIDDEN },
  [ERROR_CODES.CONFLICT]: { code: V1_ERROR_CODES.CONFLICT },
  [ERROR_CODES.ROW_VERSION_CONFLICT]: { code: V1_ERROR_CODES.CONFLICT },
  [ERROR_CODES.PLAN_FEATURE_LOCKED]: { code: V1_ERROR_CODES.PLAN_FEATURE_DISABLED, status: 403 },
  [ERROR_CODES.PLAN_LIMIT_REACHED]: { code: V1_ERROR_CODES.PLAN_LIMIT, status: 402 },
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: { code: V1_ERROR_CODES.PAYLOAD_TOO_LARGE },
  [ERROR_CODES.INTERNAL]: { code: V1_ERROR_CODES.SERVER_ERROR },
};

/**
 * Our services name fields in camelCase (`ownerId`); WaDesk's request fields are snake_case (`owner_id`). A validation path is rewritten
 * segment by segment so `details` names the field the client sent. Only identifier-shaped segments are touched: an index (`0`) or a
 * client's own attribute key with other characters is left as it is.
 */
export function snakeSegment(segment: string): string {
  return /^[a-z][a-zA-Z0-9]*$/.test(segment) && /[A-Z]/.test(segment)
    ? segment.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    : segment;
}

/** `[{ path, message }]` to WaDesk's `{ field: [messages] }`. */
function toDetails(errors: Problem['errors']): Record<string, string[]> | undefined {
  if (!errors || errors.length === 0) return undefined;
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = e.path ? e.path.split('.').map(snakeSegment).join('.') : '_';
    (out[path] ??= []).push(e.message);
  }
  return out;
}

export function toV1Error(
  problem: Problem,
  /** Methods the path does answer, when the router knows it under another method (a 404 that is really a 405). */
  allowedMethods: readonly string[] = [],
  method = '',
  path = '',
): { status: number; body: V1Error } {
  if (
    problem.code === ERROR_CODES.NOT_FOUND &&
    allowedMethods.length > 0 &&
    !allowedMethods.includes(method)
  ) {
    return {
      status: 405,
      body: {
        error: {
          code: V1_ERROR_CODES.METHOD_NOT_ALLOWED,
          message: `The ${method} method is not supported for route ${path.replace(/^\//, '')}. Supported methods: ${allowedMethods.join(', ')}.`,
          ...(problem.requestId ? { requestId: problem.requestId } : {}),
        },
      },
    };
  }
  const mapped = CODE_MAP[problem.code];
  const status = mapped?.status ?? problem.status;
  // A missing key and a generic 401 share UNAUTHENTICATED; a 401 that is not about the key never happens on this surface.
  const code = mapped?.code ?? problem.code.toLowerCase();
  const details = toDetails(problem.errors);
  return {
    status,
    body: {
      error: {
        code,
        message: problem.detail ?? problem.title,
        ...(details ? { details } : {}),
        ...(problem.requestId ? { requestId: problem.requestId } : {}),
      },
    },
  };
}

const CATCH_ALL_METHOD_COUNT = 10;

interface RouterLayer {
  route?: { methods?: Record<string, boolean> };
  match?: (path: string) => boolean;
}

/**
 * The methods a path answers, read from the live router: Nest answers an unknown method on a known path with 404, WaDesk with 405 and the
 * list of methods that do work. Empty when the path is unknown to the router (a real 404).
 */
export function methodsOfPath(request: Request): string[] {
  const app = request.app as unknown as {
    router?: { stack?: RouterLayer[] };
    _router?: { stack?: RouterLayer[] };
  };
  const stack = app.router?.stack ?? app._router?.stack ?? [];
  const methods = new Set<string>();
  for (const layer of stack) {
    if (!layer.route || !layer.match?.(request.path)) continue;
    const on = Object.entries(layer.route.methods ?? {}).filter(([, v]) => v);
    // A route registered for every method (a catch-all) says nothing about which methods the path really answers.
    if (on.length > CATCH_ALL_METHOD_COUNT) continue;
    for (const [m] of on) {
      if (m !== '_all' && m !== 'head' && m !== 'options') methods.add(m.toUpperCase());
    }
  }
  return [...methods].sort();
}

/** Registered once for `/api/v1`; see `registerProblemRenderer`. */
export const renderV1Error: ProblemRenderer = (
  problem: Problem,
  request: Request,
  response: Response,
): boolean => {
  const allowed = problem.code === ERROR_CODES.NOT_FOUND ? methodsOfPath(request) : [];
  const { status, body } = toV1Error(problem, allowed, request.method, request.path);
  if (status === 405) response.setHeader('Allow', allowed.join(', '));
  response.status(status).type('application/json').send(body);
  return true;
};
