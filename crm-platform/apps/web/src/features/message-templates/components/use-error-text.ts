'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

export interface ErrorText {
  text: string;
  /** The server's own words, shown for the codes where they matter (Meta's reason, the lint list). */
  detail?: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
  code?: string;
}

/** Codes whose `detail` is the point: Meta's own reason for a refusal. */
const SHOWS_DETAIL = new Set(['TPL_META_REJECTED']);

/** Branches on the problem `code`, never on the message. Unknown codes fall back to a generic line plus the request id. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('message-templates.errors');
  return (e) => {
    if (e instanceof ApiError) {
      return {
        text: t.has(e.code) ? t(e.code) : t('generic'),
        detail: SHOWS_DETAIL.has(e.code) ? e.message : undefined,
        requestId: e.requestId,
        fieldErrors: e.fieldErrors,
        code: e.code,
      };
    }
    return { text: t('generic'), fieldErrors: [] };
  };
}

/**
 * The words for a failed upload of a header or card file. The file's own problem is the point, so a refusal names it: too big, wrong
 * kind, the provider's limit, or the server's own sentence when no fixed text fits (never the bare "Something went wrong").
 */
export function useUploadErrorText(): (e: unknown) => ErrorText {
  const base = useErrorText();
  const t = useTranslations('message-templates.errors');
  return (e) => {
    const r = base(e);
    if (!(e instanceof ApiError)) return { ...r, text: t('uploadNetwork') };
    const fixed: Record<string, string> = {
      PAYLOAD_TOO_LARGE: 'uploadTooLarge',
      AUTH_UPLOAD_REJECTED: 'uploadRejected',
      WABA_PROVIDER_UNAVAILABLE: 'uploadProviderBusy',
      RATE_LIMITED: 'uploadProviderBusy',
      TPL_HEADER_STORAGE_REQUIRED: 'TPL_HEADER_STORAGE_REQUIRED',
      TPL_NO_CONNECTION: 'TPL_NO_CONNECTION',
    };
    const byStatus = e.status === 413 ? 'uploadTooLarge' : null;
    const key = fixed[e.code] ?? byStatus;
    if (key) return { ...r, text: t(key), detail: undefined };
    // Anything else: the server's own sentence says what is wrong with the file (type, Meta's reason, a failed scan).
    return {
      ...r,
      text: t('uploadRefused'),
      detail: e.code === 'INTERNAL' || e.code === 'UNKNOWN' ? undefined : e.message,
    };
  };
}
