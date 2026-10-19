'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deriveClientKey, wabooMigrationRunSchema, type WabooMigrationRun } from '@crm/contracts';
import { Alert, Button, Checkbox, Field, Input, Modal } from '@crm/ui';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { WMIG_DB_RE, errorKind } from './lib/errors';
import { localToIso, runAtProblem } from './lib/run-at';
import { RUNS_QUERY_KEY } from './queries';
import { RunAtField } from './run-at-field';

const NS = 'waboo-migration.form';

/**
 * Start a dry run, or (after a typed confirmation) a real migration, for ONE Waboo organization, now or at a chosen time.
 * The Migrate button stays disabled until the organization's latest dry run is green (and under 24 hours old). The server enforces
 * every rule again; the form only guides.
 */
export function MigrateForm({ onStarted }: { onStarted: (run: WabooMigrationRun) => void }) {
  const t = useTranslations(NS);
  const tc = useTranslations('waboo-migration.confirm');
  const te = useTranslations('waboo-migration.common.errors');
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const [org, setOrg] = useState('');
  const [runAt, setRunAt] = useState('');
  // testing switch: the whole workspace migrates but its WhatsApp number is not imported or connected
  const [skipWhatsapp, setSkipWhatsapp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmMode, setConfirmMode] = useState<'load' | 'catchup'>('load');
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const orgOk = WMIG_DB_RE.test(org);
  const scheduleBad = runAtProblem(runAt, new Date()) !== null;
  const valid = orgOk && !scheduleBad;
  // no earlier dry run is needed: a migration starts with its own full rehearsal and loads nothing when that is not clean
  const canLoad = valid;

  const start = useMutation({
    mutationFn: (mode: 'dry' | 'load' | 'catchup') =>
      operatorFetch('/waboo-migration/runs', {
        method: 'POST',
        body: {
          organizationId: org,
          mode,
          skipWhatsapp,
          ...(mode !== 'dry' ? { confirm: typed } : {}),
          ...(runAt ? { runAt: localToIso(runAt) } : {}),
        },
        schema: wabooMigrationRunSchema,
      }),
    onSuccess: async (run) => {
      setProblem(null);
      setConfirming(false);
      setTyped('');
      toast.success(runAt ? t('scheduled') : t('queued'));
      await Promise.all([qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY })]);
      onStarted(run);
    },
    onError: (err) => {
      const kind = errorKind(err);
      setProblem(te(kind));
      if (kind === 'active') void qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
    },
  });

  const busy = start.isPending;

  return (
    <section className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('org')}
          htmlFor={`${id}-org`}
          hint={orgOk ? t('derived', { client: deriveClientKey(org) }) : t('orgHint')}
          error={org && !orgOk ? t('orgInvalid') : undefined}
        >
          <Input
            id={`${id}-org`}
            value={org}
            onChange={(e) => setOrg(e.target.value.trim())}
            invalid={Boolean(org) && !orgOk}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
          />
        </Field>
        <RunAtField value={runAt} onChange={setRunAt} />
      </div>
      <div>
        <Checkbox
          id={`${id}-skipwa`}
          checked={skipWhatsapp}
          onChange={(e) => setSkipWhatsapp(e.target.checked)}
          label={t('skipWhatsapp')}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('skipWhatsappHint')}</p>
      </div>
      {problem && !confirming && <Alert tone="danger">{problem}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => start.mutate('dry')} disabled={!valid || busy}>
          {busy && !confirming ? t('dryRunning') : runAt ? t('scheduleDry') : t('dryRun')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null);
            setTyped('');
            setConfirmMode('load');
            setConfirming(true);
          }}
          disabled={!canLoad || busy}
        >
          {runAt ? t('scheduleMigrate') : t('migrate')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null);
            setTyped('');
            setConfirmMode('catchup');
            setConfirming(true);
          }}
          disabled={!valid || busy}
        >
          {t('catchUp')}
        </Button>
        <p className="min-w-0 basis-full text-xs text-muted-foreground sm:basis-auto">
          {t('migrateHint')}
        </p>
      </div>

      <Modal
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title={tc(confirmMode === 'catchup' ? 'catchupTitle' : 'title', { org })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => start.mutate(confirmMode)} disabled={busy || typed !== org}>
              {tc(confirmMode === 'catchup' ? 'catchupSubmit' : 'submit')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm">
            {tc(confirmMode === 'catchup' ? 'catchupBody' : 'body', { org })}
          </p>
          <Field label={tc('label', { org })} htmlFor={`${id}-confirm`}>
            <Input
              id={`${id}-confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          {problem && <Alert tone="danger">{problem}</Alert>}
        </div>
      </Modal>
    </section>
  );
}
