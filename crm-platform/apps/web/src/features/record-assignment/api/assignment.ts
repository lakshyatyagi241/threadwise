'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  assignmentRuleSchema,
  assignmentRunPageSchema,
  assignmentSettingsSchema,
  companySelectItemSchema,
  contactSelectItemSchema,
  pipelineResponseSchema,
  testAssignmentResponseSchema,
  type AssignmentSubject,
  type CreateAssignmentRuleInput,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api/client';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const RA_KEYS = {
  all: ['record-assignment'] as const,
  rules: ['record-assignment', 'rules'] as const,
  settings: ['record-assignment', 'settings'] as const,
  runs: ['record-assignment', 'runs'] as const,
  pipelines: ['record-assignment', 'pipelines'] as const,
};

const assignmentRulePageSchema = z.object({ data: z.array(assignmentRuleSchema) });

export const RUNS_PAGE_SIZE = 25;

export interface RunFilters {
  subject: AssignmentSubject;
  outcome?: 'assigned' | 'reassigned' | 'skipped';
  ruleId?: string;
}

/** Every call of Settings > Automation > Record assignment rules. Rules and records are named by uuid. */
export const assignmentApi = {
  settings: (signal?: AbortSignal) =>
    apiFetch('/assignment/settings', { schema: assignmentSettingsSchema, signal }),
  saveSettings: (input: UpdateAssignmentSettingsInput) =>
    apiFetch('/assignment/settings', {
      method: 'PUT',
      body: input,
      schema: assignmentSettingsSchema,
    }),
  list: (signal?: AbortSignal) =>
    apiFetch('/assignment/rules', { schema: assignmentRulePageSchema, signal }),
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
  clone: (id: string) =>
    apiFetch(`/assignment/rules/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      schema: assignmentRuleSchema,
    }),
  setActive: (id: string, active: boolean) =>
    apiFetch(`/assignment/rules/${encodeURIComponent(id)}/${active ? 'activate' : 'pause'}`, {
      method: 'POST',
      schema: assignmentRuleSchema,
    }),
  reorder: (input: ReorderAssignmentRulesInput) =>
    apiFetch('/assignment/rules/reorder', {
      method: 'POST',
      body: input,
      schema: assignmentRulePageSchema,
    }),
  test: (input: TestAssignmentInput) =>
    apiFetch('/assignment/test', {
      method: 'POST',
      body: input,
      schema: testAssignmentResponseSchema,
    }),
  runs: (filters: RunFilters, cursor: string | undefined, signal?: AbortSignal) =>
    apiFetch('/assignment/runs', {
      query: { ...filters, cursor, limit: RUNS_PAGE_SIZE },
      schema: assignmentRunPageSchema,
      signal,
    }),
  pipelines: (signal?: AbortSignal) =>
    apiFetch('/pipelines', { schema: z.array(pipelineResponseSchema), signal }),
};

export function useAssignmentSettings() {
  return useQuery({
    queryKey: RA_KEYS.settings,
    queryFn: ({ signal }) => assignmentApi.settings(signal),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useAssignmentRules() {
  return useQuery({
    queryKey: RA_KEYS.rules,
    queryFn: ({ signal }) => assignmentApi.list(signal),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

/** The pipelines and their stages, for the deal conditions. Someone who may not read them just gets no choices. */
export function usePipelineChoices(enabled = true) {
  return useQuery({
    queryKey: RA_KEYS.pipelines,
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) => assignmentApi.pipelines(signal),
  });
}

/** The run log of one module, newest first, one cursor page at a time. */
export function useAssignmentRuns(filters: RunFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...RA_KEYS.runs, filters],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => assignmentApi.runs(filters, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export interface RecordHit {
  id: string;
  label: string;
}

const dealHitsSchema = z.object({
  data: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()),
});

/** Real records to test a rule on: the same typeahead endpoints the pickers of each module use. */
export const recordSearchApi = {
  search: async (
    subject: AssignmentSubject,
    q: string,
    signal?: AbortSignal,
  ): Promise<RecordHit[]> => {
    const term = q.trim() || undefined;
    if (subject === 'contact') {
      const rows = await apiFetch('/contacts/select-data', {
        query: { q: term, limit: 10 },
        schema: z.array(contactSelectItemSchema),
        signal,
      });
      return rows.map((r) => ({ id: r.id, label: r.name || r.email || r.phone || r.id }));
    }
    if (subject === 'company') {
      const rows = await apiFetch('/companies/select-data', {
        query: { q: term, limit: 10 },
        schema: z.array(companySelectItemSchema),
        signal,
      });
      return rows.map((r) => ({ id: r.id, label: r.name }));
    }
    const page = await apiFetch('/deals', {
      query: { q: term, limit: 10 },
      schema: dealHitsSchema,
      signal,
    });
    return page.data.map((r) => ({ id: r.id, label: r.title }));
  },
};

export function useRecordSearch(subject: AssignmentSubject, q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...RA_KEYS.all, 'search', subject, q.trim()],
    enabled,
    retry: false,
    staleTime: 15_000,
    queryFn: ({ signal }) => recordSearchApi.search(subject, q, signal),
  });
}
