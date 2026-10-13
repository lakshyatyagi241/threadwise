'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  WMIG_MAX_BATCH,
  wabooMigrationBatchDetailSchema,
  type WabooMigrationBatchDetail,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Textarea } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { errorKind } from './lib/errors';
import { parseOrgIds } from './lib/org-ids';
import { localToIso, runAtProblem } from './lib/run-at';
import { BATCHES_QUERY_KEY, READINESS_KEY, useReadiness } from './queries';
import { RunAtField } from './run-at-field';

const NS = 'waboo-migration.bulk';

/**
 * Bulk: paste up to 50 organization ids (one per line), optionally pick a start time. Dry-run-all is always available; Migrate-all
 * is disabled until EVERY organization has a green dry run from the last 24 hours, and needs the number of organizations typed.
 * The organizations then run one after another on the server.
 */
export function BulkForm({ onStarted }: { onStarted: (batch: WabooMigrationBatchDetail) => void }) {
  const t = useTranslations(NS);
  const tc = useTranslations('waboo-migration.bulkConfirm');
  const te = useTranslations('waboo-migration.common.errors');
  const tr = useTranslations('waboo-migration.readiness');
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [text, setText] = useState('');
  const [runAt, setRunAt] = useState('');
  const [stopOnFailure, setStop] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = useMemo(() => parseOrgIds(text), [text]);
  const scheduleBad = runAtProblem(runAt, new Date()) !== null;
  const valid = parsed.ok && !scheduleBad;
  const readiness = useReadiness(parsed.ok ? parsed.ids : []);
  const rows = readiness.data?.data ?? [];
  const notReady = rows.filter((r) => !r.canLoad);
  const canLoad = valid && rows.length === parsed.ids.length && notReady.length === 0;

  const start = useMutation({
    mutationFn: (mode: 'dry' | 'load') =>
      operatorFetch('/waboo-migration/batches', {
        method: 'POST',
        body: {
          organizationIds: parsed.ids,
          mode,
          stopOnFailure,
          ...(mode === 'load' ? { confirmCount: Number(typed) } : {}),
          ...(runAt ? { runAt: localToIso(runAt) } : {}),
        },
        schema: wabooMigrationBatchDetailSchema,
      }),
    onSuccess: async (batch) => {
      setProblem(null);
      setConfirming(false);
      setTyped('');
      toast.success(runAt ? t('scheduled') : t('queued'));
      await Promise.all([
        qc.invalidateQueries({ queryKey: BATCHES_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: READINESS_KEY }),
      ]);
      onStarted(batch);
    },
    onError: (err) => setProblem(te(errorKind(err))),
  });
  const busy = start.isPending;
  const n = parsed.ids.length;

  const issues: string[] = [];
  if (parsed.invalid.length)
    issues.push(t('invalid', { ids: parsed.invalid.slice(0, 5).join(', ') }));
  if (parsed.duplicates.length)
    issues.push(t('duplicates', { ids: parsed.duplicates.slice(0, 5).join(', ') }));
  if (parsed.collisions.length)
    issues.push(t('collisions', { ids: parsed.collisions.slice(0, 5).join(', ') }));
  if (parsed.tooMany) issues.push(t('tooMany', { max: WMIG_MAX_BATCH }));

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <Field
        label={t('ids')}
        htmlFor={`${id}-ids`}
        hint={t('idsHint', { max: WMIG_MAX_BATCH })}
        error={issues.length ? issues.join(' ') : undefined}
      >
        <Textarea
          id={`${id}-ids`}
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          invalid={issues.length > 0}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {t('count', { count: n, max: WMIG_MAX_BATCH })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <RunAtField value={runAt} onChange={setRunAt} />
        <div className="self-end">
          <Checkbox
            id={`${id}-stop`}
            checked={stopOnFailure}
            onChange={(e) => setStop(e.target.checked)}
            label={t('stopOnFailure')}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('stopHint')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('sequential')}</p>
      {parsed.ok && rows.length > 0 && notReady.length > 0 && (
        <Alert tone="info" className="space-y-1">
          <p>{t('notReady', { count: notReady.length })}</p>
          <ul className="space-y-1 text-xs">
            {notReady.slice(0, 10).map((r) => (
              <li key={r.organizationId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{r.organizationId}</span>
                <Badge>{tr(r.reason as 'no_dry' | 'not_green' | 'stale')}</Badge>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {problem && !confirming && <Alert tone="danger">{problem}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => start.mutate('dry')} disabled={!valid || busy}>
          {busy && !confirming ? t('dryRunning') : t('dryAll')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null);
            setTyped('');
            setConfirming(true);
          }}
          disabled={!canLoad || busy}
        >
          {t('migrateAll')}
        </Button>
        <p className="min-w-0 basis-full text-xs text-muted-foreground sm:basis-auto">
          {t('migrateHint')}
        </p>
      </div>

      <Modal
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title={tc('title', { count: n })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={() => start.mutate('load')}
              disabled={busy || typed.trim() !== String(n)}
            >
              {tc('submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm">{tc('body', { count: n })}</p>
          <Field label={tc('label', { count: n })} htmlFor={`${id}-confirm`}>
            <Input
              id={`${id}-confirm`}
              inputMode="numeric"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </Field>
          {problem && <Alert tone="danger">{problem}</Alert>}
        </div>
      </Modal>
    </section>
  );
}
