import { z } from 'zod';
import type {
  LscBackfillResult,
  LscRunsQuery,
  LscRunsResponse,
  LscScoreResult,
  LscSettings,
  UpdateLscSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * The contracts type these responses as interfaces (the API validates its input, not its output), so the boundary check is the
 * shape each screen leans on: an object with the fields it reads first. The types are the contracts'.
 */
const shape = <T>(...required: string[]): z.ZodType<T, z.ZodTypeDef, unknown> =>
  z.custom<T>(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      required.every((k) => k in (v as Record<string, unknown>)),
    'Unexpected response',
  );

const settings = shape<LscSettings>('enabled', 'platformEnabled', 'keySource', 'last30d');
const runs = shape<LscRunsResponse>('data', 'page');
const scored = shape<LscScoreResult>('contactId', 'score', 'costUsd');
const backfilled = shape<LscBackfillResult>('queued');

const BASE = '/lead-scoring';
const enc = encodeURIComponent;

/** Every call of the lead scoring screens. Mutations get an Idempotency-Key from the client. */
export const lscApi = {
  settings: (signal?: AbortSignal) => apiFetch(`${BASE}/settings`, { schema: settings, signal }),
  saveSettings: (input: UpdateLscSettingsInput) =>
    apiFetch(`${BASE}/settings`, { method: 'PATCH', body: input, schema: settings }),
  runs: (query: Partial<LscRunsQuery>, signal?: AbortSignal) =>
    apiFetch(`${BASE}/runs`, { query, schema: runs, signal }),
  /** Scores one contact now; the call waits for the AI provider, so it takes seconds. */
  score: (contactId: string) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}/score`, { method: 'POST', schema: scored }),
  /** Queues contacts that have no score yet; they are scored in the background. */
  backfill: (limit: number) =>
    apiFetch(`${BASE}/backfill`, { method: 'POST', body: { limit }, schema: backfilled }),
};
