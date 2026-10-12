'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@crm/ui';
import { isBackgroundFailure } from '@/lib/api/background';

/** The hashes of the background queries that are failing right now, kept in step with the query cache. */
function useFailedBackgroundQueries(): string[] {
  const client = useQueryClient();
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    const cache = client.getQueryCache();
    const read = () =>
      setFailed((prev) => {
        const next = cache
          .getAll()
          .filter(isBackgroundFailure)
          .map((q) => q.queryHash)
          .sort();
        return next.length === prev.length && next.every((h, i) => h === prev[i]) ? prev : next;
      });
    read();
    return cache.subscribe(read);
  }, [client]);
  return failed;
}

/**
 * Sits under the top bar. When something the chrome keeps fresh in the background (the bell count, the Inbox badge, the balance,
 * the plan bar, the workspace list) could not be loaded after its retries, it says so and offers "Try again", so a stale number
 * never passes for a current one. It clears itself when the data comes back; "Dismiss" hides it until a different set fails.
 */
export function BackgroundErrorBanner() {
  const t = useTranslations('shell.backgroundError');
  const client = useQueryClient();
  const failed = useFailedBackgroundQueries();
  const [dismissed, setDismissed] = useState('');
  const key = failed.join('|');
  if (failed.length === 0 || dismissed === key) return null;
  return (
    <Alert
      tone="warning"
      data-testid="background-error-banner"
      className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 md:mx-6"
    >
      <span>{t('message')}</span>
      <span className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void client.refetchQueries({ predicate: isBackgroundFailure, type: 'all' })
          }
        >
          {t('retry')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(key)}>
          {t('dismiss')}
        </Button>
      </span>
    </Alert>
  );
}
