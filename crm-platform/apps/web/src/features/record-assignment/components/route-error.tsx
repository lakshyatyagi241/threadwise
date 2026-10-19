'use client';

import { useEffect } from 'react';
import { Alert, Button } from '@crm/ui';
import { useRa } from './use-ra';

/**
 * The segment's own error boundary: an unexpected render error in this screen stays inside the app shell as an inline message with a
 * retry, instead of falling through to the app-wide "Something went wrong" page that replaces the whole document.
 */
export function RecordAssignmentRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useRa();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="mx-auto max-w-5xl space-y-3" data-testid="record-assignment-error">
      <Alert tone="danger">
        <p>{t('list.loadFailed')}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={reset}>
          {t('list.retry')}
        </Button>
      </Alert>
    </section>
  );
}
