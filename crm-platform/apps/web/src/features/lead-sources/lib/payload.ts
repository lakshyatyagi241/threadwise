import { leadPayloadSchema } from '@crm/contracts';

/** A payload the admin pastes to preview a mapping or to post as a test lead: JSON, an object, at most 64 KB. */
export const PAYLOAD_MAX_BYTES = 64 * 1024;

export type PayloadParse =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'empty' | 'invalidJson' | 'notObject' | 'tooLarge' };

export function parsePayload(text: string): PayloadParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'invalidJson' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, reason: 'notObject' };
  // The contract's own bound: the stringified object may not pass 64 KB.
  const parsed = leadPayloadSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'tooLarge' };
  return { ok: true, payload: parsed.data };
}

/** The stored payload as the event drawer shows it: formatted, read only. */
export const formatPayload = (payload: Record<string, unknown>): string =>
  JSON.stringify(payload, null, 2);
