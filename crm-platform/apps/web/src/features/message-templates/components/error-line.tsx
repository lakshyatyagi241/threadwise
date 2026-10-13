'use client';

import { Alert } from '@crm/ui';
import type { ErrorText } from './use-error-text';

/** A failed call as an alert: our words, Meta's reason when it is the point, and the request id for support. */
export function ErrorAlert({ error, className }: { error: ErrorText; className?: string }) {
  return (
    <Alert tone="danger" className={className}>
      <p>{error.text}</p>
      {error.detail && <p className="mt-1 whitespace-pre-line break-words">{error.detail}</p>}
    </Alert>
  );
}
