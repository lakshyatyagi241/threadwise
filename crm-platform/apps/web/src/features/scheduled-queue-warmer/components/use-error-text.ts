'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

export interface ErrorText {
  text: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
  /** The plan does not include the feature, or its limit is reached: the screen shows the upgrade pointer. */
  plan: boolean;
}

/** Turns a failed call into text. A code we have words for is translated; anything else shows the server's own message. Branches on `code`. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('scheduled-queue-warmer.errors');
  return (e) => {
    if (e instanceof ApiError) {
      return {
        text: t.has(e.code) ? t(e.code) : e.message || t('generic'),
        requestId: e.requestId,
        fieldErrors: e.fieldErrors,
        plan: e.code === 'PLAN_FEATURE_LOCKED' || e.code === 'PLAN_LIMIT_REACHED',
      };
    }
    return { text: t('generic'), fieldErrors: [], plan: false };
  };
}
