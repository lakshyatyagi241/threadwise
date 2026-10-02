'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';

export interface ErrorText {
  text: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
}

/**
 * Turns a failed call into text. A code we have words for is translated; anything else shows the server's own message,
 * which for a Meta rejection carries Meta's reason. Branches on `code`, never on the message.
 */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('whatsapp-cloud-api-waba.errors');
  return (e) => {
    if (e instanceof ApiError) {
      return {
        text: t.has(e.code) ? t(e.code) : e.message || t('generic'),
        requestId: e.requestId,
        fieldErrors: e.fieldErrors,
      };
    }
    return { text: t('generic'), fieldErrors: [] };
  };
}
