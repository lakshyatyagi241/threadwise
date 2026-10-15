import { createHash, timingSafeEqual } from 'node:crypto';
import { parseLine, type PipelineEvent } from './waboo-migration.rules';

/** A shorter token is refused outright: the endpoints stay closed until a real one is configured. */
export const MIN_RUNNER_TOKEN_LENGTH = 32;

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/**
 * Is this the runner agent's bearer token? Constant time (both sides are hashed to the same length first, so neither the length nor
 * the position of a difference leaks), and false whenever the API has no token of the minimum length configured.
 */
export function runnerTokenMatches(
  configured: string | undefined,
  header: string | undefined,
): boolean {
  if (!configured || configured.length < MIN_RUNNER_TOKEN_LENGTH) return false;
  const m = (header?.trim() ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!), digest(configured));
}

/** The raw stdout lines of one report as the validated events the worker stores (anything that is not a known event is dropped). */
export function eventsOf(lines: string[]): PipelineEvent[] {
  const out: PipelineEvent[] = [];
  for (const l of lines) {
    const ev = parseLine(l);
    if (ev) out.push(ev);
  }
  return out;
}
