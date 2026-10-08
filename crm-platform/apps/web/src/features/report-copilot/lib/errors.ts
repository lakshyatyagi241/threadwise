import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type LibraryErrorKind =
  | 'keyRequired'
  | 'providerUnsupported'
  | 'forbidden'
  | 'tooBig'
  | 'badType'
  | 'unreadable'
  | 'full'
  | 'network'
  | 'generic';

/** Which message a failed library call gets. Branches on the stable code and status, never on the server's wording. */
export function libraryErrorKind(error: unknown): LibraryErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.REPORT_AI_KEY_MISSING:
      return 'keyRequired';
    case ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED:
      return 'providerUnsupported';
    case ERROR_CODES.REPORT_DOC_TOO_LARGE:
      return 'tooBig';
    case ERROR_CODES.REPORT_DOC_TYPE_UNSUPPORTED:
      return 'badType';
    case ERROR_CODES.REPORT_DOC_UNREADABLE:
    case ERROR_CODES.REPORT_DOC_NO_TEXT:
      return 'unreadable';
    case ERROR_CODES.REPORT_DOC_LIMIT_REACHED:
      return 'full';
  }
  if (error.status === 403) return 'forbidden';
  if (error.status === 413) return 'tooBig';
  return 'generic';
}

export type ChatErrorKind = 'keyRequired' | 'providerUnsupported' | 'generic';

/**
 * CopilotKit reports a failed runtime call as an `Error`. A failed run says `HTTP <status>: <response text>`, which carries the
 * problem `code` of the API's answer; a failed first contact (the runtime info request) carries only the status, and the runtime
 * route answers 422 there for exactly the two missing-key problems. So: read the code when it is in the text, else treat a 422 on
 * the info request as the key problem. Anything else is an ordinary failure.
 */
export function chatErrorKind(error: unknown): ChatErrorKind {
  const e = (typeof error === 'object' && error !== null ? error : {}) as {
    message?: unknown;
    payload?: unknown;
    runtimeInfoStatus?: unknown;
  };
  const text = [
    typeof e.message === 'string' ? e.message : String(error ?? ''),
    typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload ?? ''),
  ].join(' ');
  if (text.includes(ERROR_CODES.REPORT_AI_PROVIDER_UNSUPPORTED)) return 'providerUnsupported';
  if (text.includes(ERROR_CODES.REPORT_AI_KEY_MISSING) || e.runtimeInfoStatus === 422)
    return 'keyRequired';
  return 'generic';
}

/** Rejects a file before it is sent: the extension and the size limit the API checks again. */
export function checkFile(
  file: { name: string; size: number },
  extensions: readonly string[],
  maxBytes: number,
): 'ok' | 'tooBig' | 'badType' {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (!extensions.includes(ext)) return 'badType';
  return file.size > maxBytes ? 'tooBig' : 'ok';
}

/**
 * The plain sentence the API puts on a failed run (it never carries a vendor's raw text), for the alert under the chat. Nothing for a
 * transport failure (`HTTP 502: ...`, `Failed to fetch`) or anything long, so those keep the page's own wording.
 */
export function chatErrorDetail(error: unknown): string | null {
  const m =
    typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : error;
  if (typeof m !== 'string') return null;
  const text = m.trim();
  if (text === '' || text.length > 200) return null;
  if (/^HTTP \d{3}\b/.test(text) || /failed to fetch|networkerror|load failed/i.test(text))
    return null;
  return text;
}
