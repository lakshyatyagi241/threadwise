'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import type { ErrorText } from './use-error-text';

/** A failed call as an alert: our words, Meta's reason when it is the point, and the request id for support. */
export function ErrorAlert({ error, className }: { error: ErrorText; className?: string }) {
  const t = useTranslations('message-templates.common');
  return (
    <Alert tone="danger" className={className}>
      <p>{error.text}</p>
      {error.detail && <p className="mt-1 whitespace-pre-line break-words">{error.detail}</p>}
      {error.requestId && (
        <p className="mt-1 text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{error.requestId}</span>
        </p>
      )}
    </Alert>
  );
}
