import {
  reportDocumentListResponseSchema,
  reportDocumentSchema,
  type ReportDocument,
  type ReportDocumentListResponse,
  type ReportScope,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { redirectOnIdle } from '@/lib/auth/idle-redirect';
import {
  operatorAuthRedirect,
  operatorFetch,
  reportIpBlock,
} from '@/features/auth-registration-security/platform/operator-fetch';

/**
 * The browser's address for the assistant's server side. A workspace goes through the staff proxy (`/api/v2/*` becomes `/v2/*`),
 * the operator console through the operator proxy (`/api/platform/*` becomes `/v2/platform/*`). Both attach the session token, so the
 * page never holds one.
 */
const BASE: Record<ReportScope, string> = {
  workspace: '/api/v2/report-copilot',
  platform: '/api/platform/report-copilot',
};

/** Where the CopilotKit provider talks to (cookie session, same origin: no headers or token to pass). */
export const runtimeUrl = (scope: ReportScope): string => `${BASE[scope]}/runtime`;

/** The path the shared fetch helpers take (they add their own prefix). */
const path = (rest: string) => `/report-copilot${rest}`;

/**
 * Uploads one file as multipart. The shared fetch helpers send JSON only, so this keeps their error handling (problem+json to
 * `ApiError`, idle sign-out, operator sign-in and IP-block redirects) and lets the browser set the multipart boundary itself.
 */
async function postFile(scope: ReportScope, file: File, name?: string): Promise<ReportDocument> {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  const res = await fetch(`${BASE[scope]}/documents`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: form,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const error = toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
    if (scope === 'workspace') {
      redirectOnIdle(error);
    } else if (typeof window !== 'undefined') {
      reportIpBlock(error);
      const to = operatorAuthRedirect(
        error,
        `${window.location.pathname}${window.location.search}`,
      );
      if (to && window.location.pathname !== to.split('?')[0]) window.location.assign(to);
    }
    throw error;
  }
  return reportDocumentSchema.parse(json);
}

/** Every library call of the report assistant, parsed with the shared contracts. */
export const reportCopilotApi = {
  list(scope: ReportScope, signal?: AbortSignal): Promise<ReportDocumentListResponse> {
    const req = { schema: reportDocumentListResponseSchema, signal };
    return scope === 'workspace'
      ? apiFetch(path('/documents'), req)
      : operatorFetch(path('/documents'), req);
  },
  upload(scope: ReportScope, file: File, name?: string): Promise<ReportDocument> {
    return postFile(scope, file, name);
  },
  remove(scope: ReportScope, id: string): Promise<void> {
    const url = path(`/documents/${encodeURIComponent(id)}`);
    return scope === 'workspace'
      ? apiFetch<void>(url, { method: 'DELETE' })
      : operatorFetch<void>(url, { method: 'DELETE' });
  },
};
