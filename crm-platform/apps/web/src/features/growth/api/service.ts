import { z } from 'zod';
import type {
  BroadcastAssistantInput,
  BroadcastRecommendation,
  GrowthActionDecisionInput,
  GrowthActionDecisionResult,
  GrowthActionsQuery,
  GrowthActionsResponse,
  GrowthAudiencesResponse,
  GrowthAutoStageResponse,
  GrowthCampaignReport,
  GrowthDailyDigest,
  GrowthEnrichmentStatus,
  GrowthOverview,
  GrowthPropensityModel,
  GrowthQuality,
  GrowthSendTimes,
  GrowthSettings,
  GrowthStampResult,
  SyncAudienceResult,
  UpdateGrowthSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** What the growth screen shows of one contact (the contact page card reads the same call). */
export interface GrowthContactFacts {
  propensity: { score: number; features: Record<string, unknown>; computedAt: string } | null;
  enrichment: { status: string; data: Record<string, unknown>; fetchedAt: string } | null;
}

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

const settings = shape<GrowthSettings>('available', 'features', 'config');
const overview = shape<GrowthOverview>('settings', 'digest');
const actions = shape<GrowthActionsResponse>('data', 'openByType', 'page');
const decided = shape<GrowthActionDecisionResult>('done', 'failed');
const campaigns = shape<GrowthCampaignReport>('data', 'totals');
const stamped = shape<GrowthStampResult>('stamped', 'campaignsRecounted');
const audiences = shape<GrowthAudiencesResponse>('data');
const synced = shape<SyncAudienceResult>('key', 'groupId', 'members');
const sendTimes = shape<GrowthSendTimes>('bestHours', 'inboundByHour', 'readByHour');
const propensity = shape<GrowthPropensityModel>('trained', 'positives', 'contacts');
const quality = shape<GrowthQuality>('suggestions', 'actions', 'cost');
const digest = shape<GrowthDailyDigest>('day', 'highlights');
const autoStage = shape<GrowthAutoStageResponse>('data', 'dailyCap', 'appliedToday');
const recommendation = shape<BroadcastRecommendation>('audience', 'template', 'reasons');
const enrichment = shape<GrowthEnrichmentStatus>('configured', 'found');
const enrichRun = shape<{ asked: number }>('asked');
const contactFacts = shape<GrowthContactFacts>('propensity', 'enrichment');

const BASE = '/growth';
const enc = encodeURIComponent;

/** Every call of the Growth screens. Mutations get an Idempotency-Key from the client. */
export const growthApi = {
  settings: (signal?: AbortSignal) => apiFetch(`${BASE}/settings`, { schema: settings, signal }),
  saveSettings: (input: UpdateGrowthSettingsInput) =>
    apiFetch(`${BASE}/settings`, { method: 'PATCH', body: input, schema: settings }),
  overview: (signal?: AbortSignal) => apiFetch(`${BASE}/overview`, { schema: overview, signal }),
  actions: (query: Partial<GrowthActionsQuery>, signal?: AbortSignal) =>
    apiFetch(`${BASE}/actions`, { query, schema: actions, signal }),
  decide: (input: GrowthActionDecisionInput) =>
    apiFetch(`${BASE}/actions/decide`, { method: 'POST', body: input, schema: decided }),
  campaigns: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/campaigns/report`, { schema: campaigns, signal }),
  stamp: () => apiFetch(`${BASE}/campaigns/stamp`, { method: 'POST', schema: stamped }),
  audiences: (signal?: AbortSignal) => apiFetch(`${BASE}/audiences`, { schema: audiences, signal }),
  syncAudience: (key: string) =>
    apiFetch(`${BASE}/audiences/sync`, { method: 'POST', body: { key }, schema: synced }),
  /** The hours counted in `timezone` (the viewer's zone); the workspace's when left out. */
  sendTimes: (timezone?: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/send-times${timezone ? `?timezone=${enc(timezone)}` : ''}`, {
      schema: sendTimes,
      signal,
    }),
  propensity: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/propensity`, { schema: propensity, signal }),
  recompute: () => apiFetch(`${BASE}/propensity/recompute`, { method: 'POST', schema: propensity }),
  quality: (signal?: AbortSignal) => apiFetch(`${BASE}/quality`, { schema: quality, signal }),
  digest: (signal?: AbortSignal) => apiFetch(`${BASE}/digest`, { schema: digest, signal }),
  autoStage: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/auto-stage`, { schema: autoStage, signal }),
  undoAutoStage: (id: string) =>
    apiFetch(`${BASE}/auto-stage/${enc(id)}/undo`, { method: 'POST', schema: z.unknown() }),
  recommend: (input: BroadcastAssistantInput) =>
    apiFetch(`${BASE}/assistant/broadcast`, {
      method: 'POST',
      body: input,
      schema: recommendation,
    }),
  enrichment: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/enrichment`, { schema: enrichment, signal }),
  runEnrichment: () => apiFetch(`${BASE}/enrichment/run`, { method: 'POST', schema: enrichRun }),
  contact: (contactId: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}`, { schema: contactFacts, signal }),
};
