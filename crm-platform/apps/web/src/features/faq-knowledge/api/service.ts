import { z } from 'zod';
import type {
  AddFaqVariationsInput,
  BulkFaqEntriesInput,
  CreateFaqEntryInput,
  FaqBulkResult,
  FaqEntry,
  FaqEntryListResponse,
  FaqFlowNodesResponse,
  FaqGenerateResult,
  FaqInsights,
  FaqLogResponse,
  FaqMatchDecision,
  FaqSettings,
  FaqVariation,
  GenerateFaqVariationsInput,
  LearnFaqLogInput,
  ListFaqEntriesQuery,
  ListFaqLogQuery,
  UpdateFaqEntryInput,
  UpdateFaqSettingsInput,
  UpdateFaqVariationInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * The contracts type the FAQ responses as interfaces (the API validates its input, not its output), so the boundary check here is
 * the shape every screen leans on: an object (or a list of them) with the fields the screens read first. The types are the contracts'.
 */
const shape = <T>(...required: string[]): z.ZodType<T, z.ZodTypeDef, unknown> =>
  z.custom<T>(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      required.every((k) => k in (v as Record<string, unknown>)),
    'Unexpected response',
  );

const entryList = shape<FaqEntryListResponse>('data', 'page', 'stats');
const entry = shape<FaqEntry>('id', 'question', 'variations', 'rowVersion');
const variation = shape<FaqVariation>('id', 'text', 'embedState');
const variations: z.ZodType<FaqVariation[], z.ZodTypeDef, unknown> = z.custom<FaqVariation[]>(
  (v) => Array.isArray(v),
  'Unexpected response',
);
const decision = shape<FaqMatchDecision>('outcome', 'candidates', 'threshold');
const insights = shape<FaqInsights>('totals', 'daily', 'scoreHistogram');
const logPage = shape<FaqLogResponse>('data', 'page');
const settings = shape<FaqSettings>('enabled', 'threshold', 'limits', 'usage');
const flowNodes = shape<FaqFlowNodesResponse>('data');
const bulk = shape<FaqBulkResult>('affected');
const generated = shape<FaqGenerateResult>('suggestions');
const learned = shape<{ added: boolean }>('added');

type Query = Record<string, string | number | boolean | undefined>;
const asQuery = (q: object): Query => q as Query;
const enc = encodeURIComponent;
const BASE = '/faq';

/** Every call of the FAQ screens. Mutations get an Idempotency-Key from the client; ids are uuids. */
export const faqApi = {
  list: (query: Partial<ListFaqEntriesQuery>, signal?: AbortSignal) =>
    apiFetch(`${BASE}/entries`, { query: asQuery(query), schema: entryList, signal }),
  get: (id: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/entries/${enc(id)}`, { schema: entry, signal }),
  create: (input: CreateFaqEntryInput) =>
    apiFetch(`${BASE}/entries`, { method: 'POST', body: input, schema: entry }),
  update: (id: string, input: UpdateFaqEntryInput) =>
    apiFetch(`${BASE}/entries/${enc(id)}`, { method: 'PATCH', body: input, schema: entry }),
  remove: (id: string) => apiFetch(`${BASE}/entries/${enc(id)}`, { method: 'DELETE' }),
  bulk: (input: BulkFaqEntriesInput) =>
    apiFetch(`${BASE}/entries/bulk`, { method: 'POST', body: input, schema: bulk }),

  addVariations: (id: string, input: AddFaqVariationsInput) =>
    apiFetch(`${BASE}/entries/${enc(id)}/variations`, {
      method: 'POST',
      body: input,
      schema: variations,
    }),
  generate: (id: string, input: GenerateFaqVariationsInput) =>
    apiFetch(`${BASE}/entries/${enc(id)}/variations/generate`, {
      method: 'POST',
      body: input,
      schema: generated,
    }),
  updateVariation: (id: string, variationId: string, input: UpdateFaqVariationInput) =>
    apiFetch(`${BASE}/entries/${enc(id)}/variations/${enc(variationId)}`, {
      method: 'PATCH',
      body: input,
      schema: variation,
    }),
  removeVariation: (id: string, variationId: string) =>
    apiFetch(`${BASE}/entries/${enc(id)}/variations/${enc(variationId)}`, { method: 'DELETE' }),

  /** The steps of one of the workspace's flows (for the "Start at" picker); 422 FAQ_FLOW_NOT_FOUND for a foreign flow. */
  flowNodes: (flowId: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/flows/${enc(flowId)}/nodes`, { schema: flowNodes, signal }),

  test: (query: string) =>
    apiFetch(`${BASE}/test`, { method: 'POST', body: { query }, schema: decision }),
  summary: (days: number, signal?: AbortSignal) =>
    apiFetch(`${BASE}/insights/summary`, { query: { days }, schema: insights, signal }),
  log: (query: Partial<ListFaqLogQuery>, signal?: AbortSignal) =>
    apiFetch(`${BASE}/insights/log`, { query: asQuery(query), schema: logPage, signal }),
  learn: (logId: string, input: LearnFaqLogInput) =>
    apiFetch(`${BASE}/insights/log/${enc(logId)}/learn`, {
      method: 'POST',
      body: input,
      schema: learned,
    }),
  dismiss: (logId: string) =>
    apiFetch(`${BASE}/insights/log/${enc(logId)}/dismiss`, { method: 'POST' }),

  settings: (signal?: AbortSignal) => apiFetch(`${BASE}/settings`, { schema: settings, signal }),
  saveSettings: (input: UpdateFaqSettingsInput) =>
    apiFetch(`${BASE}/settings`, { method: 'PUT', body: input, schema: settings }),
};
