import { HELP_AGENT_TASK_HEADER } from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';

/**
 * What went wrong with a call to our model proxy, kept apart from the page-agent library (which flattens every failure into a
 * sentence and drops the request id). The panel shows a clear message and the request id, never a blank panel
 * (docs/specs/help-agent-assistant.md section 7, decision 6).
 */
export interface Failure {
  status: number;
  code: string;
  requestId: string | null;
  /** Seconds to wait, when the server said so. */
  retryAfter: number | null;
}

/** The message key (under `help-agent.errors`) that explains a failure to a person. */
export type FailureKey =
  | 'disabled'
  | 'planLocked'
  | 'forbidden'
  | 'rateLimited'
  | 'taskLimit'
  | 'stepLimit'
  | 'closed'
  | 'providerDown'
  | 'monthlyLimit'
  | 'signedOut'
  | 'network'
  | 'generic';

export function failureKey(f: Failure): FailureKey {
  switch (f.code) {
    case 'HELP_AGENT_DISABLED':
      return 'disabled';
    case 'PLAN_FEATURE_LOCKED':
      return 'planLocked';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'RATE_LIMITED':
      return 'rateLimited';
    case 'HELP_AGENT_TASK_LIMIT':
      return 'taskLimit';
    case 'HELP_AGENT_STEP_LIMIT':
      return 'stepLimit';
    case 'HELP_AGENT_TASK_CLOSED':
    case 'NOT_FOUND':
      return 'closed';
    case 'HELP_AGENT_PROVIDER_UNAVAILABLE':
      return 'providerDown';
    case 'PLAN_LIMIT_REACHED':
      return 'monthlyLimit';
    case 'UNAUTHENTICATED':
      return 'signedOut';
    case 'NETWORK':
      return 'network';
    default:
      if (f.status === 429) return 'rateLimited';
      if (f.status === 401) return 'signedOut';
      return 'generic';
  }
}

export interface FetchDeps {
  taskId: string;
  fetchImpl?: typeof fetch;
  onFailure: (failure: Failure) => void;
  newRequestId?: () => string;
}

/**
 * The `fetch` the library uses for the model call. Same-origin with the session cookie (the Next proxy at `/api/v2` attaches the token),
 * a request id the server logs, and the task id header. A failed call is recorded here with its code and request id, then returned
 * unchanged so the library still sees the status. Nothing about the request body is kept.
 */
export function makeModelFetch(deps: FetchDeps): typeof fetch {
  const doFetch = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return async (input, init) => {
    const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();
    const headers = new Headers(init?.headers);
    headers.set('X-Request-Id', requestId);
    headers.set(HELP_AGENT_TASK_HEADER, deps.taskId);
    headers.set('Accept', 'application/json');
    let res: Response;
    try {
      res = await doFetch(input, { ...init, headers, credentials: 'same-origin' });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        deps.onFailure({ status: 0, code: 'NETWORK', requestId, retryAfter: null });
      }
      throw err;
    }
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.clone().json();
      } catch {
        body = undefined;
      }
      const error = toApiError(
        res.status,
        body,
        res.headers.get('x-request-id') ?? requestId,
        res.headers.get('retry-after'),
      );
      const wait = Number(error.fieldErrors.find((e) => e.path === 'retryAfterSeconds')?.message);
      deps.onFailure({
        status: res.status,
        code: error.code,
        requestId: error.requestId ?? requestId,
        retryAfter: Number.isFinite(wait) && wait > 0 ? wait : null,
      });
    }
    return res;
  };
}
