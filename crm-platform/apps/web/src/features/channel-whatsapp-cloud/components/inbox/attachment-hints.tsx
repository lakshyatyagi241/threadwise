'use client';

import { useTranslations } from 'next-intl';
import { limitHints } from '../../lib/limits';
import type { AttachmentCheck } from '../../lib/limits';

/** The one line under the composer that says what WhatsApp accepts: "Images up to 5 MB, audio and video up to 16 MB, ...". */
export function AttachmentHints({ allowed }: { allowed: readonly string[] }) {
  const t = useTranslations('channel-whatsapp-cloud.inbox.attach');
  const hints = limitHints(allowed);
  if (hints.length === 0) return null;
  return (
    <span data-testid="inbox-attach-hint">
      {hints.map((h, i) => (
        <span key={h.kind}>
          {i > 0 && ' · '}
          {t(`limit.${h.kind}`, { mb: h.mb })}
        </span>
      ))}
    </span>
  );
}

/** The refusal of a file before it is uploaded, in the person's language. */
export function useAttachmentError() {
  const t = useTranslations('channel-whatsapp-cloud.inbox.attach');
  return (check: Exclude<AttachmentCheck, { ok: true }>): string => {
    switch (check.reason) {
      case 'tooLarge':
        return t('errors.tooLarge', {
          kind: t(`kind.${check.kind!}`),
          mb: (check.maxBytes ?? 0) / (1024 * 1024),
        });
      case 'kindNotAllowed':
        return t('errors.kindNotAllowed', { kind: t(`kind.${check.kind!}`) });
      case 'unsupportedType':
        return t('errors.unsupportedType');
      case 'empty':
        return t('errors.empty');
    }
  };
}
