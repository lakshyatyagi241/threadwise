'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { RETENTION_CONFIRM, type RetentionRunResponse } from '@crm/contracts';
import { Alert, Button, Card, Input } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { runRetention } from '../api';

const NS = 'plans-subscriptions-trials.operator.retention';

/**
 * Data retention (TW-PLAN-023), super admin only: preview which lapsed workspaces the nightly sweep would wipe and how many rows, or run it now.
 * A preview deletes nothing; a real run needs the word WIPE typed in.
 */
export function RetentionPanel({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations(NS);
  const [result, setResult] = useState<RetentionRunResponse | null>(null);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      runRetention(dryRun ? { dryRun: true } : { dryRun: false, confirm }),
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      if (!r.dryRun) setConfirm('');
    },
    onError: (e) =>
      setError(e instanceof ApiError && e.status === 403 ? t('forbidden') : t('failed')),
  });

  return (
    <Card className="space-y-3 p-5" data-testid="retention-panel">
      <div className="space-y-1">
        <h2 className="font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate(true)}>
            {t('preview')}
          </Button>
          <label className="space-y-1 text-sm">
            <span>{t('typeToConfirm', { word: RETENTION_CONFIRM })}</span>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-32 font-mono"
            />
          </label>
          <Button
            variant="danger"
            disabled={run.isPending || confirm !== RETENTION_CONFIRM}
            onClick={() => run.mutate(false)}
          >
            {t('wipeNow')}
          </Button>
        </div>
      ) : null}
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <div className="space-y-2 text-sm" data-testid="retention-result">
          <Alert tone={result.dryRun ? 'info' : 'warning'}>
            {result.dryRun
              ? t('previewDone', { count: result.workspaces.length })
              : t('wiped', { count: result.workspaces.filter((w) => w.wiped).length })}
          </Alert>
          <ul className="space-y-1">
            {result.workspaces.map((w) => (
              <li key={w.slug}>
                <span className="font-medium">{w.slug}</span>{' '}
                <span className="text-muted-foreground">
                  {t('rows', { count: Object.values(w.rows).reduce((a, b) => a + b, 0) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
