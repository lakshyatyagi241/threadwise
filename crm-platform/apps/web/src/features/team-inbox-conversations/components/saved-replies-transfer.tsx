'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  SAVED_REPLY_IMPORT_MAX_BYTES,
  type SavedReplyDuplicatePolicy,
  type SavedReplyImportIssue,
  type SavedReplyImportResult,
} from '@crm/contracts';
import { Alert, Button, Modal, Spinner, useToast } from '@crm/ui';
import { downloadBlob } from '@/features/contacts-attributes-tags/lib/download';
import { exportSavedReplies, importSavedReplies, refreshSavedReplies } from '../api/saved-replies';
import { useErrorText } from './parts';

/** "Export CSV": the shared library as a file (personal replies stay with their owners). */
/** Every reason the server can give for a row, each with a message under `transfer.issue`. */
const ISSUES: readonly SavedReplyImportIssue[] = [
  'missing_shortcut',
  'shortcut_invalid',
  'missing_title',
  'title_too_long',
  'missing_body',
  'body_too_long',
  'control_characters',
  'category_too_long',
  'language_invalid',
  'channel_unknown',
  'duplicate_in_file',
  'plan_limit_reached',
];
const issueKey = (issue: string | null, action: string): string =>
  issue && (issue === 'duplicate' || (ISSUES as readonly string[]).includes(issue))
    ? issue
    : action;

export function ExportRepliesButton() {
  const t = useTranslations('team-inbox-conversations.savedReplies.transfer');
  const { toast } = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      downloadBlob('saved-replies.csv', await exportSavedReplies());
    } catch (e) {
      toast(errorText(e), 'danger');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="secondary"
      onClick={() => void run()}
      disabled={busy}
      data-testid="saved-reply-export"
    >
      {busy && <Spinner />}
      {t('export')}
    </Button>
  );
}

/**
 * "Import CSV": pick a file, choose what happens to a shortcut that already exists (leave it, or replace it), CHECK the file (a dry run:
 * nothing is saved and every row is reported), then import. A changed file or choice needs a new check, so what is imported is what was
 * shown.
 */
export function ImportRepliesButton({ disabled }: { disabled?: boolean }) {
  const t = useTranslations('team-inbox-conversations.savedReplies.transfer');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="saved-reply-import"
      >
        {t('import')}
      </Button>
      {open && <ImportModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('team-inbox-conversations.savedReplies.transfer');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [policy, setPolicy] = useState<SavedReplyDuplicatePolicy>('skip');
  const [checked, setChecked] = useState<SavedReplyImportResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reset = () => setChecked(null);
  const tooBig = file !== null && file.size > SAVED_REPLY_IMPORT_MAX_BYTES;

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    try {
      const out = await importSavedReplies(file, { duplicatePolicy: policy, dryRun });
      if (dryRun) {
        setChecked(out);
      } else {
        await refreshSavedReplies(qc);
        toast(t('done', { created: out.totals.create, updated: out.totals.update }), 'success');
        onClose();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const writes = checked ? checked.totals.create + checked.totals.update : 0;
  return (
    <Modal open onClose={onClose} title={t('title')}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('intro', { maxKb: SAVED_REPLY_IMPORT_MAX_BYTES / 1024 })}
        </p>
        <div className="space-y-1">
          <label htmlFor="saved-reply-file" className="text-sm font-medium">
            {t('file')}
          </label>
          <input
            id="saved-reply-file"
            ref={input}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="block w-full text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              reset();
            }}
          />
          {tooBig && <p className="text-xs text-danger">{t('tooBig')}</p>}
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t('duplicates')}</legend>
          {(['skip', 'overwrite'] as const).map((p) => (
            <label key={p} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="saved-reply-policy"
                checked={policy === p}
                onChange={() => {
                  setPolicy(p);
                  reset();
                }}
              />
              <span>
                {t(`policy.${p}`)}
                <span className="block text-xs text-muted-foreground">{t(`policyHint.${p}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error !== null && <Alert tone="danger">{errorText(error)}</Alert>}

        {checked && (
          <div className="space-y-2" data-testid="saved-reply-import-result">
            <p className="text-sm font-medium">
              {t('summary', {
                create: checked.totals.create,
                update: checked.totals.update,
                skip: checked.totals.skip,
                invalid: checked.totals.invalid,
              })}
            </p>
            {checked.plan.limit !== null && (
              <p className="text-xs text-muted-foreground">
                {t('plan', { used: checked.plan.used, limit: checked.plan.limit })}
              </p>
            )}
            {checked.rows.length > 0 && (
              <ul className="max-h-48 divide-y divide-border overflow-auto rounded-md border border-border text-xs">
                {checked.rows.map((r) => (
                  <li
                    key={`${r.line}-${r.shortcut}`}
                    className="flex justify-between gap-2 px-2 py-1"
                  >
                    <span className="min-w-0 truncate" dir="auto">
                      {t('row', { line: r.line, shortcut: r.shortcut || '-' })}
                    </span>
                    <span
                      className={r.action === 'invalid' ? 'text-danger' : 'text-muted-foreground'}
                    >
                      {t(`issue.${issueKey(r.issue, r.action)}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {checked.rowsTruncated && (
              <p className="text-xs text-muted-foreground">{t('truncated')}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            {t('cancel')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void run(true)}
            disabled={!file || tooBig || busy !== null}
            data-testid="saved-reply-import-check"
          >
            {busy === 'check' && <Spinner />}
            {t('check')}
          </Button>
          <Button
            onClick={() => void run(false)}
            disabled={!checked || writes === 0 || busy !== null}
            data-testid="saved-reply-import-go"
          >
            {busy === 'import' && <Spinner />}
            {t('go', { count: writes })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
