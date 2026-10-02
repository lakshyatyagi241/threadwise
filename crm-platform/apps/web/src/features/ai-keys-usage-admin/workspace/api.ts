'use client';

import { useQuery } from '@tanstack/react-query';
import { aiModelsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const AI_KEYS = {
  keys: ['ai', 'provider-keys'] as const,
  usage: ['ai', 'usage'] as const,
  models: ['ai', 'models'] as const,
};

/**
 * The text models this workspace can pick for an AI feature (the platform's active providers, with the workspace's own
 * vendor models in place where its own key will be used). The AI assistant, flow and "build with AI" pickers read this
 * so they never offer a model no key can serve.
 */
export function useAiModels() {
  return useQuery({
    queryKey: AI_KEYS.models,
    queryFn: ({ signal }) => apiFetch('/ai/models', { schema: aiModelsResponseSchema, signal }),
    staleTime: 60_000,
  });
}
