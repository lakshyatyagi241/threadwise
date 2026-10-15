'use client';

import { useQuery } from '@tanstack/react-query';
import {
  assignmentRuleSchema,
  assignmentSettingsSchema,
  testAssignmentResponseSchema,
  type CreateAssignmentRuleInput,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const CA_KEYS = {
  rules: ['contact-assignment', 'rules'] as const,
  settings: ['contact-assignment', 'settings'] as const,
};

const ruleListSchema = z.object({ data: z.array(assignmentRuleSchema) });
const pipelineListSchema = z.array(z.object({ id: z.string(), name: z.string() }).passthrough());

/** Every call of Settings > Automation > Contact assignment. Rules are named by uuid. */
export const contactAssignmentApi = {
  settings: (signal?: AbortSignal) =>
    apiFetch('/assignment/settings', { schema: assignmentSettingsSchema, signal }),
  saveSettings: (input: UpdateAssignmentSettingsInput) =>
    apiFetch('/assignment/settings', {
      method: 'PUT',
      body: input,
      schema: assignmentSettingsSchema,
    }),
  list: (signal?: AbortSignal) => apiFetch('/assignment/rules', { schema: ruleListSchema, signal }),
  create: (input: CreateAssignmentRuleInput) =>
    apiFetch('/assignment/rules', { method: 'POST', body: input, schema: assignmentRuleSchema }),
  update: (id: string, input: UpdateAssignmentRuleInput) =>
    apiFetch(`/assignment/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: assignmentRuleSchema,
    }),
  remove: (id: string) =>
    apiFetch(`/assignment/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorder: (input: ReorderAssignmentRulesInput) =>
    apiFetch('/assignment/rules/reorder', { method: 'POST', body: input, schema: ruleListSchema }),
  test: (input: TestAssignmentInput) =>
    apiFetch('/assignment/test', {
      method: 'POST',
      body: input,
      schema: testAssignmentResponseSchema,
    }),
  pipelines: (signal?: AbortSignal) =>
    apiFetch('/pipelines', { schema: pipelineListSchema, signal }),
};

export function useAssignmentSettings() {
  return useQuery({
    queryKey: CA_KEYS.settings,
    queryFn: ({ signal }) => contactAssignmentApi.settings(signal),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useAssignmentRules() {
  return useQuery({
    queryKey: CA_KEYS.rules,
    queryFn: ({ signal }) => contactAssignmentApi.list(signal),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function usePipelineChoices() {
  return useQuery({
    queryKey: ['contact-assignment', 'pipelines'],
    queryFn: ({ signal }) => contactAssignmentApi.pipelines(signal),
    retry: false,
  });
}
