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
/** `/faq/flows/<flow>`: every FAQ belongs to one flow, so every call is scoped by it. */
const base = (flowId: string) => `/faq/flows/${enc(flowId)}`;

/** Every call of the FAQ screens. Mutations get an Idempotency-Key from the client; ids are uuids. */
export const faqApi = {
  list: (flowId: string, query: Partial<ListFaqEntriesQuery>, signal?: AbortSignal) =>
    apiFetch(`${base(flowId)}/entries`, { query: asQuery(query), schema: entryList, signal }),
  get: (flowId: string, id: string, signal?: AbortSignal) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}`, { schema: entry, signal }),
  create: (flowId: string, input: CreateFaqEntryInput) =>
    apiFetch(`${base(flowId)}/entries`, { method: 'POST', body: input, schema: entry }),
  update: (flowId: string, id: string, input: UpdateFaqEntryInput) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}`, {
      method: 'PATCH',
      body: input,
      schema: entry,
    }),
  remove: (flowId: string, id: string) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}`, { method: 'DELETE' }),
  bulk: (flowId: string, input: BulkFaqEntriesInput) =>
    apiFetch(`${base(flowId)}/entries/bulk`, { method: 'POST', body: input, schema: bulk }),

  addVariations: (flowId: string, id: string, input: AddFaqVariationsInput) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}/variations`, {
      method: 'POST',
      body: input,
      schema: variations,
    }),
  generate: (flowId: string, id: string, input: GenerateFaqVariationsInput) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}/variations/generate`, {
      method: 'POST',
      body: input,
      schema: generated,
    }),
  updateVariation: (
    flowId: string,
    id: string,
    variationId: string,
    input: UpdateFaqVariationInput,
  ) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}/variations/${enc(variationId)}`, {
      method: 'PATCH',
      body: input,
      schema: variation,
    }),
  removeVariation: (flowId: string, id: string, variationId: string) =>
    apiFetch(`${base(flowId)}/entries/${enc(id)}/variations/${enc(variationId)}`, {
      method: 'DELETE',
    }),

  /**
   * The steps of one of the workspace's flows: the answer's target, which is this flow or another one (for the "Go to" picker).
   * 422 FAQ_FLOW_NOT_FOUND for a foreign flow.
   */
  flowNodes: (targetFlowId: string, signal?: AbortSignal) =>
    apiFetch(`/faq/flow-nodes/${enc(targetFlowId)}`, { schema: flowNodes, signal }),

  test: (flowId: string, query: string) =>
    apiFetch(`${base(flowId)}/test`, { method: 'POST', body: { query }, schema: decision }),
  summary: (flowId: string, days: number, signal?: AbortSignal) =>
    apiFetch(`${base(flowId)}/insights/summary`, { query: { days }, schema: insights, signal }),
  log: (flowId: string, query: Partial<ListFaqLogQuery>, signal?: AbortSignal) =>
    apiFetch(`${base(flowId)}/insights/log`, { query: asQuery(query), schema: logPage, signal }),
  learn: (flowId: string, logId: string, input: LearnFaqLogInput) =>
    apiFetch(`${base(flowId)}/insights/log/${enc(logId)}/learn`, {
      method: 'POST',
      body: input,
      schema: learned,
    }),
  dismiss: (flowId: string, logId: string) =>
    apiFetch(`${base(flowId)}/insights/log/${enc(logId)}/dismiss`, { method: 'POST' }),

  settings: (flowId: string, signal?: AbortSignal) =>
    apiFetch(`${base(flowId)}/settings`, { schema: settings, signal }),
  saveSettings: (flowId: string, input: UpdateFaqSettingsInput) =>
    apiFetch(`${base(flowId)}/settings`, { method: 'PUT', body: input, schema: settings }),
};
