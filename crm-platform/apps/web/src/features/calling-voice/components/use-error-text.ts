'use client';

import { useTranslations } from 'next-intl';
import { CallError, callErrorKey, serverWorded } from '../lib/calls';

/**
 * The words for any failure of the calling screens: a failed call by its `kind`, a failed request by its error `code`, with the
 * server's own text only where it is already worded for a person (Meta's reason, the coexistence and prerequisite guidance).
 */
export function useErrorText(): (error: unknown) => string {
  const t = useTranslations('calling-voice');
  return (error) => {
    if (error instanceof CallError) {
      const base = t(`failures.${error.kind}`);
      return error.detail ? `${base}: ${error.detail}` : base;
    }
    return serverWorded(error) ?? t(`errors.${callErrorKey(error)}`);
  };
}
