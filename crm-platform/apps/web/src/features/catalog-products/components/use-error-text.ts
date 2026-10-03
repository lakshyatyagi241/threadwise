'use client';

import { useTranslations } from 'next-intl';
import { errorDetail, errorKind } from '../lib/errors';

/** The translated sentence for a failed call, chosen by problem code; Meta's own text rides along where the kind shows it. */
export function useErrorText(): (error: unknown) => string {
  const t = useTranslations('catalogProducts.errors');
  return (error) => t(errorKind(error), { detail: errorDetail(error) });
}
