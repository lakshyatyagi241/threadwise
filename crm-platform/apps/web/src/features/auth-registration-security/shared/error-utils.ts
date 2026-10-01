import { ApiError } from '@/lib/api/errors';

/** Seconds to wait, from a rate-limit or lockout refusal (`fieldErrors` entry `retryAfterSeconds`). */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const hit = error.fieldErrors.find((f) => f.path === 'retryAfterSeconds');
  if (!hit) return null;
  const n = Number(hit.message);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Every message the server attached to one of the given input paths. */
export function fieldMessages(error: unknown, ...paths: string[]): string[] {
  if (!(error instanceof ApiError)) return [];
  return error.fieldErrors.filter((f) => paths.includes(f.path)).map((f) => f.message);
}

/** The first message for the given paths, or undefined. */
export function firstFieldMessage(error: unknown, ...paths: string[]): string | undefined {
  return fieldMessages(error, ...paths)[0];
}

/** A request id worth showing for an unexpected failure. */
export function requestIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

/** `{ path: message }` from the server's field errors, first message per path. */
export function fieldErrorMap(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(error instanceof ApiError)) return out;
  for (const f of error.fieldErrors) if (!(f.path in out)) out[f.path] = f.message;
  return out;
}

/** Turns a Zod error's issues into `{ path: message }`, first per path. */
export function zodFieldMap(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.join('.');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}
