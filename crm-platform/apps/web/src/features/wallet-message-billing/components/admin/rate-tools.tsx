'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ImportRatesResult, SyncMetaResult } from '@crm/contracts';
import { Alert, Button, ConfirmDialog, Modal, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';

/** WaDesk's limit on the rate-card upload. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** Sync Meta costs, Import rate card and Re-seed starter rate card. Each previews or confirms before it writes. */
export function RateTools() {
  const t = useTranslations('wallet-message-billing.admin.pricing.tools');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [sync, setSync] = useState(false);
  const [importing, setImporting] = useState(false);
  const [seed, setSeed] = useState(false);

  const seeder = useMutation({
    mutationFn: () => operatorApi.seedRates(),
    onSuccess: (r) => {
      setSeed(false);
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      toast.success(t('seed.done', { count: r.upserted }));
    },
    onError: (err) => {
      setSeed(false);
      toast.error(te(errorKind(err)));
    },
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => setSync(true)}>
        {t('sync.button')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
        {t('import.button')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setSeed(true)}>
        {t('seed.button')}
      </Button>
      {sync && <SyncDialog onClose={() => setSync(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      <ConfirmDialog
        open={seed}
        title={t('seed.title')}
        message={t('seed.warning')}
        confirmLabel={t('seed.confirm')}
        cancelLabel={tc('cancel')}
        tone="danger"
        busy={seeder.isPending}
        onConfirm={() => seeder.mutate()}
        onClose={() => setSeed(false)}
      />
    </div>
  );
}

function SyncDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.tools.sync');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [preview, setPreview] = useState<SyncMetaResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => operatorApi.syncMeta(dryRun),
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        return;
      }
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      void qc.invalidateQueries({ queryKey: KEYS.settings });
      toast.success(t('done', { added: r.added, updated: r.updated }));
      onClose();
    },
    onError: (err) => setFailed(te(errorKind(err))),
  });

  // The preview is requested as the dialog opens, so the operator always sees what Apply will do before it does it.
  const { mutate } = run;
  useEffect(() => {
    mutate(true);
  }, [mutate]);

  return (
    <Modal
      open
      onClose={() => !run.isPending && onClose()}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => run.mutate(false)} disabled={!preview || run.isPending}>
            {run.isPending && preview && <Spinner label={t('applying')} />}
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm" aria-live="polite">
        {failed ? (
          <Alert tone="danger">{failed}</Alert>
        ) : !preview ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner label={t('loading')} />
            {t('loading')}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('source')}</dt>
              <dd className="font-medium">{preview.sourceLabel}</dd>
              <dt className="text-muted-foreground">{t('version')}</dt>
              <dd className="font-medium">{preview.version ?? t('noVersion')}</dd>
              <dt className="text-muted-foreground">{t('currency')}</dt>
              <dd className="font-medium">{preview.currency}</dd>
              <dt className="text-muted-foreground">{t('added')}</dt>
              <dd className="font-medium tabular-nums">{preview.added}</dd>
              <dt className="text-muted-foreground">{t('updated')}</dt>
              <dd className="font-medium tabular-nums">{preview.updated}</dd>
            </dl>
            <p className="text-muted-foreground">{t('untouched')}</p>
            {preview.source === 'bundled' && <Alert tone="info">{t('bundledNote')}</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.tools.import');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<'tooBig' | 'notCsv' | 'unreadable' | null>(null);
  const [preview, setPreview] = useState<ImportRatesResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: ({ text, dryRun }: { text: string; dryRun: boolean }) =>
      operatorApi.importRates(text, dryRun),
    onSuccess: (r) => {
      if (r.dryRun) {
        setPreview(r);
        return;
      }
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      toast.success(t('done', { added: r.added, updated: r.updated, skipped: r.skipped }));
      onClose();
    },
    onError: (err) => setFailed(te(errorKind(err))),
  });

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPreview(null);
    setFailed(null);
    setCsv(null);
    setFileProblem(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setFileProblem('notCsv');
    if (file.size > MAX_IMPORT_BYTES) return setFileProblem('tooBig');
    try {
      const text = await file.text();
      setCsv(text);
      run.mutate({ text, dryRun: true });
    } catch {
      setFileProblem('unreadable');
    }
  };

  return (
    <Modal
      open
      size="md"
      onClose={() => !run.isPending && onClose()}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={run.isPending}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => csv && run.mutate({ text: csv, dryRun: false })}
            disabled={!csv || !preview || preview.added + preview.updated === 0 || run.isPending}
          >
            {run.isPending && preview && <Spinner label={t('applying')} />}
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('intro')}</p>
        <div className="space-y-1.5">
          <label htmlFor="rate-import-file" className="block font-medium">
            {t('file')}
          </label>
          <input
            id="rate-import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pick(e)}
            className="block w-full text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-muted-foreground">{t('limit')}</p>
        </div>
        <div aria-live="polite" className="space-y-3">
          {fileProblem && <Alert tone="danger">{t(`fileProblems.${fileProblem}`)}</Alert>}
          {failed && <Alert tone="danger">{failed}</Alert>}
          {run.isPending && !preview && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner label={t('reading')} />
              {t('reading')}
            </p>
          )}
          {preview && <ImportPreview preview={preview} />}
        </div>
      </div>
    </Modal>
  );
}

export function ImportPreview({ preview }: { preview: ImportRatesResult }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.tools.import');
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t('shape')}</dt>
          <dd className="font-medium">{t(`shapes.${preview.shape}`)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('added')}</dt>
          <dd className="font-medium tabular-nums">{preview.added}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('updated')}</dt>
          <dd className="font-medium tabular-nums">{preview.updated}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('skipped')}</dt>
          <dd className="font-medium tabular-nums">{preview.skipped}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {t('currencyNote', { currency: preview.currency })}
      </p>
      {preview.problems.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">{t('problems')}</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-2 text-xs">
            {preview.problems.map((p) => (
              <li key={`${p.line}-${p.reason}`}>
                <span className="font-mono">{t('line', { line: p.line })}</span> {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
