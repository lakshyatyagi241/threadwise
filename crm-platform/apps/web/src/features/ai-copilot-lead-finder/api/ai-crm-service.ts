import {
  aiCrmIndexResponseSchema,
  aiCrmMessageResponseSchema,
  aiCrmSettingsResponseSchema,
  type AiCrmMessageInput,
  type AiCrmSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/ai-crm';

export const aiCrmApi = {
  index: (signal?: AbortSignal) => apiFetch(base, { schema: aiCrmIndexResponseSchema, signal }),
  message: (input: AiCrmMessageInput) =>
    apiFetch(`${base}/message`, { method: 'POST', body: input, schema: aiCrmMessageResponseSchema }),
  reset: () => apiFetch(`${base}/reset`, { method: 'POST' }),
  settings: (input: AiCrmSettingsInput) =>
    apiFetch(`${base}/settings`, { method: 'POST', body: input, schema: aiCrmSettingsResponseSchema }),
};
