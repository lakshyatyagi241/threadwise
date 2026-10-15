'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

export interface ErrorText {
  text: string;
  fieldErrors: Array<{ path: string; message: string }>;
  code?: string;
}

/** Branches on the problem `code`, never on the message. Unknown codes fall back to a generic line. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('ai-copilot-lead-finder.errors');
  return (e) => {
    if (e instanceof ApiError) {
      return { text: t.has(e.code) ? t(e.code) : t('generic'), fieldErrors: e.fieldErrors, code: e.code };
    }
    return { text: t('generic'), fieldErrors: [] };
  };
}
