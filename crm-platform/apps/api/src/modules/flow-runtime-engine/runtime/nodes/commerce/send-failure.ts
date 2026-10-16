import type { NodeContext, NodeResult, SendOutcome } from '../../types';
import { haltOf } from '../../halt';

/**
 * What a failed send does to a commerce node: the channel being down halts the run (it tries again by itself); any other refusal ends
 * the run `failed` when the customer was owed an answer to a prompt (`end`), and is noted and skipped otherwise (`skip`, returns null).
 */
export function sendFailed(
  out: Extract<SendOutcome, { ok: false }>,
  mode: 'skip' | 'end',
  ctx: NodeContext,
): NodeResult | null {
  if (out.halt) return haltOf(out);
  ctx.note(`send failed: ${out.error}`);
  return mode === 'end' ? { kind: 'fail', code: out.code, reason: out.error } : null;
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
