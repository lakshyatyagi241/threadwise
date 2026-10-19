'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api/errors';
import { CallError, callErrorKey, serverWorded } from '../lib/calls';
import { metaReasonOf } from '../lib/readiness';

/**
 * The words for any failure of the calling screens: a failed call by its `kind`, a failed request by its error `code`, with the
 * server's own text only where no reason code names it (Meta's own sentence for a refusal nobody has classified yet).
 *
 * `reasons: true` is for the actions Meta can refuse for a reason the card knows (switching calling on, placing a call, asking permission):
 * the reason's words come first and Meta's own sentence follows in brackets, so a reason that was mapped wrongly cannot hide the real
 * cause. Every other action (accept, decline, hang up, recordings, lists) keeps its own words.
 */
export function useErrorText(): (error: unknown, opts?: { reasons?: boolean }) => string {
  const t = useTranslations('calling-voice');
  const format = useFormatter();
  return (error, opts) => {
    if (error instanceof CallError) {
      const base = t(`failures.${error.kind}`);
      return error.detail ? `${base}: ${error.detail}` : base;
    }
    // The workspace's calling window is closed for this contact (BL-177): the answer names the instant it opens, in the reader's clock.
    if (callErrorKey(error) === 'CALL_OUTSIDE_WINDOW') {
      const opens =
        error instanceof ApiError
          ? error.fieldErrors.find((e) => e.path === 'opensAt')?.message
          : null;
      const at = opens ? new Date(opens) : null;
      return t('errors.CALL_OUTSIDE_WINDOW', {
        when:
          at && !Number.isNaN(at.getTime())
            ? format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' })
            : '',
      });
    }
    // Meta's refusals carry a stable reason the words are chosen by; its own sentence is only the fallback for a reason nobody has named.
    if (callErrorKey(error) === 'CALL_COEXISTENCE_UNSUPPORTED')
      return t('errors.CALL_COEXISTENCE_UNSUPPORTED');
    const reason = opts?.reasons ? metaReasonOf(error) : null;
    if (reason) {
      const said = error instanceof Error ? error.message.trim() : '';
      return said
        ? `${t(`readiness.reasons.${reason}`)} (${said})`
        : t(`readiness.reasons.${reason}`);
    }
    return serverWorded(error) ?? t(`errors.${callErrorKey(error)}`);
  };
}
