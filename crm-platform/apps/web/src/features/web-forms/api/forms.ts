'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  formDetailSchema,
  formPaymentGatewaySchema,
  formPaymentLinkResultSchema,
  formPropertyListSchema,
  formSubmissionDetailSchema,
  formSubmissionListSchema,
  formSummarySchema,
  formTemplateListSchema,
  formVersionListSchema,
  pageResponseSchema,
  retryFormSubmissionResultSchema,
  type CreateFormInput,
  type ExportFormSubmissionsInput,
  type FormBindObject,
  type FormDetail,
  type FormPaymentGateway,
  type FormPaymentLinkResult,
  type FormProperty,
  type FormSubmissionDetail,
  type FormSubmissionList,
  type FormSubmissionSummary,
  type FormSummary,
  type FormTemplate,
  type FormVersion,
  type ListFormSubmissionsQuery,
  type ListFormsQuery,
  type UpdateFormInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const formListSchema = pageResponseSchema(formSummarySchema);
export type FormList = {
  data: FormSummary[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
};

export const KEYS = {
  all: ['web-forms'] as const,
  list: (f: { status?: string; q?: string; includeArchived?: boolean }) =>
    ['web-forms', 'list', f] as const,
  one: (id: string) => ['web-forms', 'one', id] as const,
  versions: (id: string) => ['web-forms', 'versions', id] as const,
  templates: ['web-forms', 'templates'] as const,
  paymentGateway: ['web-forms', 'payment-gateway'] as const,
  properties: (object: FormBindObject) => ['web-forms', 'properties', object] as const,
  submissions: (id: string, f: object) => ['web-forms', 'submissions', id, f] as const,
  submission: (id: string, sid: string) => ['web-forms', 'submission', id, sid] as const,
};

const PAGE = 25;

export interface ListFilters {
  status?: ListFormsQuery['status'];
  q?: string;
  includeArchived?: boolean;
}

/** The forms list, newest first, a cursor page at a time. */
export function useForms(filters: ListFilters) {
  return useInfiniteQuery({
    queryKey: KEYS.list(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<FormList> =>
      apiFetch('/forms', {
        query: {
          limit: PAGE,
          cursor: pageParam,
          status: filters.status,
          q: filters.q || undefined,
          includeArchived: filters.includeArchived ? 'true' : undefined,
        },
        schema: formListSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

export function useForm(id: string | null) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => apiFetch(`/forms/${id}`, { schema: formDetailSchema, signal }),
    // The builder owns its copy once it has loaded: a background refetch must not replace what the person is typing.
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useFormVersions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: KEYS.versions(id),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/forms/${id}/versions`, { schema: formVersionListSchema, signal }),
    select: (r): FormVersion[] => r.data,
  });
}

export function useFormTemplates() {
  return useQuery({
    queryKey: KEYS.templates,
    queryFn: ({ signal }) =>
      apiFetch('/forms/templates', { schema: formTemplateListSchema, signal }),
    select: (r): FormTemplate[] => r.data,
    staleTime: 5 * 60_000,
  });
}

/** Whether the workspace can take payment on a form, and on which gateway (the payment gateways screen sets it). */
export function useFormPaymentGateway() {
  return useQuery<FormPaymentGateway>({
    queryKey: KEYS.paymentGateway,
    queryFn: () => apiFetch('/forms/meta/payment-gateway', { schema: formPaymentGatewaySchema }),
    staleTime: 30_000,
  });
}

/** The field picker's catalogue of one CRM object: built-in and custom properties. */
export function useFormProperties(object: FormBindObject) {
  return useQuery({
    queryKey: KEYS.properties(object),
    queryFn: ({ signal }) =>
      apiFetch('/forms/meta/properties', {
        query: { object },
        schema: formPropertyListSchema,
        signal,
      }),
    select: (r): FormProperty[] => r.data,
    staleTime: 60_000,
  });
}

export const createForm = (body: CreateFormInput): Promise<FormDetail> =>
  apiFetch('/forms', { method: 'POST', body, schema: formDetailSchema });

export const updateForm = (id: string, body: UpdateFormInput): Promise<FormDetail> =>
  apiFetch(`/forms/${id}`, { method: 'PATCH', body, schema: formDetailSchema });

type Action = 'publish' | 'pause' | 'resume' | 'archive' | 'rotate-key';
export const formAction = (id: string, action: Action, rowVersion: number): Promise<FormDetail> =>
  apiFetch(`/forms/${id}/${action}`, {
    method: 'POST',
    body: { rowVersion },
    schema: formDetailSchema,
  });

export const duplicateForm = (id: string, rowVersion: number, name?: string): Promise<FormDetail> =>
  apiFetch(`/forms/${id}/duplicate`, {
    method: 'POST',
    body: { rowVersion, ...(name ? { name } : {}) },
    schema: formDetailSchema,
  });

export const restoreVersion = (
  id: string,
  version: number,
  rowVersion: number,
): Promise<FormDetail> =>
  apiFetch(`/forms/${id}/versions/${version}/restore`, {
    method: 'POST',
    body: { rowVersion },
    schema: formDetailSchema,
  });

export const deleteForm = (id: string): Promise<void> =>
  apiFetch(`/forms/${id}`, { method: 'DELETE' });

// ---- submissions -----------------------------------------------------------------------------------------------------------------------

export type SubmissionFilters = Pick<
  ListFormSubmissionsQuery,
  'status' | 'tab' | 'from' | 'to' | 'q' | 'contactId'
>;

export function useSubmissions(formId: string, filters: SubmissionFilters) {
  return useInfiniteQuery({
    queryKey: KEYS.submissions(formId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<FormSubmissionList> =>
      apiFetch(`/forms/${formId}/submissions`, {
        query: { limit: PAGE, cursor: pageParam, ...filters },
        schema: formSubmissionListSchema,
        signal,
      }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
  });
}

export function useSubmission(formId: string, submissionId: string | null) {
  return useQuery({
    queryKey: KEYS.submission(formId, submissionId ?? ''),
    enabled: submissionId !== null,
    queryFn: ({ signal }): Promise<FormSubmissionDetail> =>
      apiFetch(`/forms/${formId}/submissions/${submissionId}`, {
        schema: formSubmissionDetailSchema,
        signal,
      }),
    // Opening answers is audited server-side: do not refetch (and re-audit) on focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** The API answers a retry with the submission as it is now (`retryFormSubmissionResultSchema`). */
export const retrySubmission = (
  formId: string,
  submissionId: string,
): Promise<FormSubmissionSummary> =>
  apiFetch(`/forms/${formId}/submissions/${submissionId}/retry`, {
    method: 'POST',
    schema: retryFormSubmissionResultSchema,
  });

/** A fresh hosted payment link for a submission awaiting payment; `url` is null when the gateway refused. */
export const newPaymentLink = (
  formId: string,
  submissionId: string,
): Promise<FormPaymentLinkResult> =>
  apiFetch(`/forms/${formId}/submissions/${submissionId}/payment-link`, {
    method: 'POST',
    schema: formPaymentLinkResultSchema,
  });

/** Money arrived outside the gateway (a transfer, cash): the submission becomes paid; the audit names the person. */
export const markSubmissionPaid = (
  formId: string,
  submissionId: string,
): Promise<FormSubmissionSummary> =>
  apiFetch(`/forms/${formId}/submissions/${submissionId}/mark-paid`, {
    method: 'POST',
    schema: retryFormSubmissionResultSchema,
  });

export const deleteSubmission = (formId: string, submissionId: string): Promise<void> =>
  apiFetch(`/forms/${formId}/submissions/${submissionId}`, { method: 'DELETE' });

/**
 * The CSV of the submissions that match the filter (`POST /forms/:id/submissions/export`). The response is the file itself: the
 * name comes from `Content-Disposition`, and `truncated` is true when the export was cut at the row limit.
 */
export async function exportSubmissions(
  formId: string,
  body: ExportFormSubmissionsInput,
): Promise<{ blob: Blob; filename: string; truncated: boolean }> {
  const res = await fetch(`/api/v2/forms/${formId}/submissions/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/csv',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    // Reuse the client's problem+json parsing so the caller branches on `code` like everywhere else.
    const text = await res.text();
    const { toApiError } = await import('@/lib/api/errors');
    throw toApiError(
      res.status,
      text ? JSON.parse(text) : undefined,
      res.headers.get('x-request-id'),
    );
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return {
    blob: await res.blob(),
    filename: named ?? 'form-submissions.csv',
    truncated: res.headers.get('x-export-truncated') === 'true',
  };
}
