'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

export interface ErrorText {
  text: string;
  detail?: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
  code?: string;
}

/** Codes whose `detail` is the point: Meta's own reason for a publish refusal. */
const SHOWS_DETAIL = new Set(['WFL_FORM_META_VALIDATION_FAILED', 'WFL_FORM_PUBLISH_FAILED']);

/** Branches on the problem `code`, never on the message. Unknown codes fall back to a generic line plus the request id. Shared by Forms and Links. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('forms-links-groups.errors');
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
