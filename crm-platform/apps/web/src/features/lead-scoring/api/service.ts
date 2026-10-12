import { z } from 'zod';
import type {
  LscBackfillResult,
  LscInsight,
  LscSuggestionDecisionInput,
  LscSuggestionDecisionResult,
  LscSuggestionsQuery,
  LscSuggestionsResponse,
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
const insight = shape<LscInsight>('active', 'digest', 'suggestion');
const suggestions = shape<LscSuggestionsResponse>('data', 'page');
const decided = shape<LscSuggestionDecisionResult>('done', 'failed');

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
  /** The latest reading of a contact's conversation and the stage move waiting for a decision. */
  insight: (contactId: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}/insight`, { schema: insight, signal }),
  /** Reads the contact's conversation now; the call waits for the AI provider, so it takes seconds. */
  digest: (contactId: string) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}/digest`, { method: 'POST', schema: insight }),
  suggestions: (query: Partial<LscSuggestionsQuery>, signal?: AbortSignal) =>
    apiFetch(`${BASE}/suggestions`, { query, schema: suggestions, signal }),
  decide: (input: LscSuggestionDecisionInput) =>
    apiFetch(`${BASE}/suggestions/decide`, { method: 'POST', body: input, schema: decided }),
};
