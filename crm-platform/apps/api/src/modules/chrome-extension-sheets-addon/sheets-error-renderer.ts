import type { Request, Response } from 'express';
import type { Problem } from '@crm/contracts';
import type { ProblemRenderer } from '../../common/filters/problem-exception.filter';

/** Every add-on route lives under here (version-neutral, so no `/v2` in front). */
export const SHEETS_PATH_PREFIX = '/api/v1/sheets-addon';

/** `[{ path, message }]` to `{ field: [messages] }`, the way a client looks up what to highlight. */
function toDetails(errors: Problem['errors']): Record<string, string[]> | undefined {
  if (!errors || errors.length === 0) return undefined;
  const out: Record<string, string[]> = {};
  for (const e of errors) (out[e.path || '_'] ??= []).push(e.message);
  return out;
}

export function toSheetsError(problem: Problem) {
  const details = toDetails(problem.errors);
  return {
    ok: false as const,
    error: problem.detail ?? problem.title,
    code: problem.code,
    ...(details ? { details } : {}),
    ...(problem.requestId ? { requestId: problem.requestId } : {}),
  };
}

/**
 * The add-on's own failure envelope, `{ ok: false, error, code }` (Reference's add-on answers `{ ok: false, error }`), whatever raised the error: a
 * guard, a pipe, the router. Registered under a longer prefix than the customer API's, so it wins inside `/api/v1`.
 */
export const renderSheetsError: ProblemRenderer = (
  problem: Problem,
  _request: Request,
  response: Response,
): boolean => {
  response.status(problem.status).type('application/json').send(toSheetsError(problem));
  return true;
};
