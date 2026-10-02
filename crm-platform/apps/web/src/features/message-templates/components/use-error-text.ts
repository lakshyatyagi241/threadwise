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
