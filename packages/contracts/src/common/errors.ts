import { z } from 'zod';

/**
 * Machine-readable application error codes. The frontend switches on `code`,
 * never on the human-readable message — messages get reworded, codes do not.
 */
export const ERROR_CODES = {
  // generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // platform invariants
  ROW_VERSION_CONFLICT: 'ROW_VERSION_CONFLICT',
  TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  // billing — hard blocks, surfaced verbatim to the user
  WALLET_INSUFFICIENT_FUNDS: 'WALLET_INSUFFICIENT_FUNDS',
  WALLET_INACTIVE: 'WALLET_INACTIVE',
  RATE_CARD_MISSING: 'RATE_CARD_MISSING',

  // messaging
  CONSENT_OPTED_OUT: 'CONSENT_OPTED_OUT',
  SERVICE_WINDOW_CLOSED: 'SERVICE_WINDOW_CLOSED',
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',

  // exams
  SLOT_CAPACITY_FULL: 'SLOT_CAPACITY_FULL',
  APPLICATION_WINDOW_CLOSED: 'APPLICATION_WINDOW_CLOSED',

  // public / partner API
  API_KEY_INVALID: 'API_KEY_INVALID',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * RFC 9457 problem+json, plus two additions of ours:
 *   `code`      — the stable application code above
 *   `requestId` — correlates the response with the server log line
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  requestId: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .describe('Field-level validation failures'),
});
export type Problem = z.infer<typeof problemSchema>;
