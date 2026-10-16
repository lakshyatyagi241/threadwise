'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COMPANY_IMPORT_CSV_MAX, COMPANY_IMPORT_ROWS_MAX } from '@crm/contracts';
import { Alert, Button, Modal, Spinner } from '@crm/ui';
import { companiesApi, invalidateCompanies } from '../api/companies';
import type { CompanyImportResult } from '../api/schemas';
import { ErrorLine } from './error-line';
import { UploadIcon } from './icons';

/** How many failed rows the result lists; the count above it is of all of them. */
const FAILED_SHOWN = 50;

/**
 * "Import companies" (BL-196): pick a CSV file, say whether a company that already exists (same website, else same name) gets its blanks
 * filled, and see what was made and what was not, with the line of each row that failed. The columns are the company's own details and
 * its properties, named by label or key in the first line. Nothing is sent until the button is pressed.
 */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('companies.import');
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [match, setMatch] = useState(true);
  const [result, setResult] = useState<CompanyImportResult | null>(null);

  const run = useMutation({
    mutationFn: () => companiesApi.importCsv(text ?? '', match),
    onSuccess: async (r) => {
      setResult(r);
      await invalidateCompanies(qc);
    },
  });

  const pick = async (file: File | undefined) => {
    setResult(null);
    run.reset();
    if (!file) return;
    setName(file.name);
    // The server refuses a bigger file; saying so here saves a long upload of text.
    if (file.size > COMPANY_IMPORT_CSV_MAX) {
      setTooBig(true);
      setText(null);
      return;
    }
    setTooBig(false);
    setText(await file.text());
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={t('title')}
      eyebrow={t('eyebrow')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {result ? t('done') : t('cancel')}
          </Button>
          {!result && (
            <Button
              variant="brand"
              disabled={text === null || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending && <Spinner />} {t('start')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{t('intro', { max: COMPANY_IMPORT_ROWS_MAX })}</p>

        <div>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={t('file')}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            <UploadIcon /> {name ? t('change') : t('choose')}
          </Button>
          {name && (
            <span className="ms-3 break-all" dir="auto">
              {name}
            </span>
          )}
          {tooBig && (
            <p role="alert" className="mt-2 text-danger">
              {t('tooBig')}
            </p>
          )}
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={match}
            onChange={(e) => setMatch(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span>
            <span className="font-medium">{t('match')}</span>
            <span className="block text-muted-foreground">{t('matchHint')}</span>
          </span>
        </label>

        {run.isError && <ErrorLine error={run.error} />}

        {result && (
          <div className="space-y-3" role="status">
            <p className="font-medium">
              {t('summary', {
                total: result.total,
                created: result.created,
                updated: result.updated,
                unchanged: result.unchanged,
                failed: result.failed.length,
              })}
            </p>
            {result.ignoredColumns.length > 0 && (
              <Alert tone="warning">
                {t('ignored', { columns: result.ignoredColumns.join(', ') })}
              </Alert>
            )}
            {result.failed.length > 0 && (
              <div>
                <p className="mb-1 font-medium">
                  {t('failedTitle', { count: result.failed.length })}
                </p>
                <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {result.failed.slice(0, FAILED_SHOWN).map((f) => (
                    <li
                      key={`${f.line}-${f.message}`}
                      className="border-b border-border/60 px-3 py-1.5 last:border-0"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {t('line', { line: f.line })}
                      </span>{' '}
                      {f.field && <span className="font-medium">{f.field}: </span>}
                      <span dir="auto">{f.message}</span>
                    </li>
                  ))}
                </ul>
                {result.failed.length > FAILED_SHOWN && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('moreFailed', { count: result.failed.length - FAILED_SHOWN })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
