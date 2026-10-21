'use client';

import { useTranslations } from 'next-intl';

/** Short texts other screens show next to a sales-activities switch; the words live in this domain's messages. */
export function useCompletionOffText(): string {
  return useTranslations('sales-activities.picker')('completeOff');
}
