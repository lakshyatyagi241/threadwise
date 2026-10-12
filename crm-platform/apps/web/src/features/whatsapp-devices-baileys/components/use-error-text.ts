'use client';

import { useTranslations } from 'next-intl';
import { describeError } from '../lib/error-model';

export interface ErrorText {
  text: string;
  requestId?: string;
  fieldErrors: Array<{ path: string; message: string }>;
  /** The plan or the cap refused: the screen shows the upgrade pointer. */
  plan: boolean;
  /** The stable code, to branch on. */
  code?: string;
  retryAfterS?: number;
  /** The throttle that refused a group action (`WA_GROUP_RATE_LIMITED`). */
  scope?: string;
  /** Starting again with `relink: true` would be accepted. */
  relinkable: boolean;
}

/** Turns a failed call into text. Branches on `code` only; a code without words reads as the generic error, never raw. */
export function useErrorText(): (e: unknown) => ErrorText {
  const t = useTranslations('whatsapp-devices-baileys.errors');
  return (e) => {
    const d = describeError(e, (code) => t.has(code));
    return {
      text: t(d.key, d.values),
      requestId: d.requestId,
      fieldErrors: d.fieldErrors,
      plan: d.plan,
      code: d.code,
      retryAfterS: d.retryAfterS,
      scope: d.scope,
      relinkable: d.relinkable === true,
    };
  };
}
