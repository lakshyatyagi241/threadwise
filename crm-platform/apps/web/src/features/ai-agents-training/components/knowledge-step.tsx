'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  AIAG_FILE_EXTENSIONS,
  AIAG_SOURCE_LIMITS,
  type AddAiagSourceInput,
  type AiagSource,
} from '@crm/contracts';
import { Button, ConfirmDialog, Spinner, cn, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { addSource, deleteSource, KEYS, uploadSource, useSources } from '../api/training';
import { checkFile, FILE_ACCEPT } from '../lib/builder-model';
import { TrashIcon } from './icons';

const INPUT =
  'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12.5px] outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/10 disabled:opacity-60';
const KINDS = ['url', 'text', 'faq', 'file'] as const;
type AddKind = (typeof KINDS)[number];

/**
 * Step 5, "Train the agent" (TW-AIAG-005..010): the four ways to add knowledge (a web page, free text, FAQs, a file) and the list
 * of this agent's entries. The knowledge belongs to this one agent. Only what a person must act on is shown: a page that is still
 * being read, and one that failed (with its reason and a way to remove it). A page is read in the background, so the list asks
 * again while one is being read.
 */
export function KnowledgeStep({
  assistantId,
  canEdit,
}: {
  assistantId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('aiTraining.knowledge');
  const qc = useQueryClient();
  const { toast } = useToast();
  const sources = useSources(assistantId);
  const [open, setOpen] = useState<AddKind | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiagSource | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    if (assistantId) void qc.invalidateQueries({ queryKey: KEYS.sources(assistantId) });
    void qc.invalidateQueries({ queryKey: KEYS.list });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteSource(pendingDelete.id);
      toast(t('removed'), 'success');
      setPendingDelete(null);
      refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('removeFailed'), 'danger');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div data-step="5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex size-[23px] shrink-0 items-center justify-center rounded-[7px] bg-muted font-mono text-[10px] font-semibold text-brand">
          05
        </span>
        <span className="flex-1 text-lg leading-none">{t('title')}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{t('tag')}</span>
      </div>

      <p className="mb-3 text-[12.5px] text-muted-foreground">{t('ownedNote')}</p>

      {assistantId === null ? (
        <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          {t('saveFirst')}
        </p>
      ) : (
        <>
          {canEdit && (
            <div
              role="group"
              aria-label={t('addLabel')}
              className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4"
            >
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={open === k}
                  onClick={() => setOpen(k)}
                  className={cn(
                    'rounded-xl border p-3 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    open === k
                      ? 'border-brand bg-emerald-50 dark:bg-emerald-950/30'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <div className="text-[13px] font-semibold">{t(`add.${k}.title`)}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(`add.${k}.body`)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {canEdit && open && (
            <AddPanel
              key={open}
              kind={open}
              assistantId={assistantId}
              onDone={() => {
                setOpen(null);
                toast(t('added'), 'success');
                refresh();
              }}
              onCancel={() => setOpen(null)}
            />
          )}

          <div className="overflow-hidden rounded-xl border border-border">
            {sources.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner label={t('loading')} />
              </div>
            ) : sources.isError ? (
              <div className="p-4 text-center text-sm">
                <p className="text-danger" role="alert">
                  {t('loadError')}
                </p>
                <Button variant="secondary" className="mt-2" onClick={() => void sources.refetch()}>
                  {t('retry')}
                </Button>
              </div>
            ) : sources.data.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul>
                {sources.data.map((s) => (
                  <SourceRow
                    key={s.id}
                    s={s}
                    canEdit={canEdit}
                    onDelete={() => setPendingDelete(s)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('removeTitle')}
        message={t('removeBody')}
        confirmLabel={t('remove')}
        cancelLabel={t('keep')}
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function SourceRow({
  s,
  canEdit,
  onDelete,
}: {
  s: AiagSource;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations('aiTraining.knowledge');
  return (
    <li className="grid grid-cols-[1fr_44px] items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40">
      <div className="min-w-0">
        <div className="truncate text-[13px]">{s.label}</div>
        {s.url && (
          <div className="truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
            {s.url}
          </div>
        )}
        {s.status === 'processing' && (
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Spinner />
            {t('reading')}
          </div>
        )}
        {s.status === 'failed' && (
          <div className="mt-0.5 break-words text-[11.5px] text-danger" role="note">
            {t('failed')}
            {s.error ? ` ${s.error}` : ''}
          </div>
        )}
      </div>
      <div className="text-end">
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            title={t('remove')}
            aria-label={t('removeNamed', { label: s.label })}
            className="inline-flex size-7 items-center justify-center rounded-full text-danger hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <TrashIcon className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

function AddPanel({
  kind,
  assistantId,
  onDone,
  onCancel,
}: {
  kind: AddKind;
  assistantId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('aiTraining.knowledge');
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  // FAQs: any number of question and answer rows, each saved as its own plain Q&A entry.
  const [rows, setRows] = useState([{ question: '', answer: '' }]);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const problem = (key: string, field: string) => {
    toast(t(`problem.${key}`), 'danger');
    setFlash(field);
    document.getElementById(`aiag-src-${field}`)?.focus();
    return false;
  };

  const validate = (): boolean => {
    if (kind !== 'faq' && label.trim() === '') return problem('label', 'label');
    if (kind === 'url' && url.trim() === '') return problem('url', 'url');
    if (kind === 'text' && content.trim() === '') return problem('content', 'content');
    if (kind === 'faq') {
      const filled = rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.question.trim() || r.answer.trim());
      if (filled.length === 0) return problem('question', 'question-0');
      for (const { r, i } of filled) {
        if (r.question.trim() === '') return problem('question', `question-${i}`);
        if (r.answer.trim() === '') return problem('answer', `answer-${i}`);
      }
    }
    if (kind === 'file') {
      if (!file) return problem('file', 'file');
      const verdict = checkFile(file, AIAG_FILE_EXTENSIONS);
      if (verdict !== 'ok') return problem(`file_${verdict}`, 'file');
    }
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    setFlash(null);
    try {
      if (kind === 'file') {
        abort.current = new AbortController();
        setProgress(0);
        await uploadSource(assistantId, file!, label.trim(), setProgress, abort.current.signal);
      } else if (kind === 'faq') {
        // One entry per row, in order; a blank row is skipped. The entry's label is its question.
        for (const r of rows.filter((x) => x.question.trim() || x.answer.trim()))
          await addSource(assistantId, {
            kind: 'qa',
            label: r.question.trim().slice(0, AIAG_SOURCE_LIMITS.label),
            question: r.question,
            answer: r.answer,
          });
      } else {
        const body: AddAiagSourceInput =
          kind === 'url'
            ? { kind, label: label.trim(), url: url.trim() }
            : { kind: 'text', label: label.trim(), content };
        await addSource(assistantId, body);
      }
      onDone();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast(
        err instanceof ApiError && err.code === 'PAYLOAD_TOO_LARGE'
          ? t('problem.tooLarge')
          : err instanceof ApiError
            ? (err.fieldErrors[0]?.message ?? err.message)
            : t('addFailed'),
        'danger',
      );
    } finally {
      setBusy(false);
      setProgress(null);
      abort.current = null;
    }
  };

  const ring = (field: string) => (flash === field ? 'border-danger ring-2 ring-danger/40' : '');
  const f = (field: string) => `aiag-src-${field}`;

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label={t(`add.${kind}.title`)}
      className="mb-3 space-y-2 rounded-xl border border-border bg-muted/30 p-3"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t(`panel.${kind}`)}
      </div>
      {kind !== 'faq' && (
        <div>
          <label htmlFor={f('label')} className="sr-only">
            {t('label')}
          </label>
          <input
            id={f('label')}
            value={label}
            maxLength={AIAG_SOURCE_LIMITS.label}
            disabled={busy}
            placeholder={t(`placeholder.label.${kind}`)}
            onChange={(e) => setLabel(e.target.value)}
            className={cn(INPUT, ring('label'))}
          />
        </div>
      )}
      {kind === 'url' && (
        <div>
          <label htmlFor={f('url')} className="sr-only">
            {t('url')}
          </label>
          <input
            id={f('url')}
            type="url"
            dir="ltr"
            value={url}
            maxLength={AIAG_SOURCE_LIMITS.url}
            disabled={busy}
            placeholder="https://yoursite.com/pricing"
            onChange={(e) => setUrl(e.target.value)}
            className={cn(INPUT, 'font-mono', ring('url'))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('urlHint')}</p>
        </div>
      )}
      {kind === 'text' && (
        <div>
          <label htmlFor={f('content')} className="sr-only">
            {t('content')}
          </label>
          <textarea
            id={f('content')}
            rows={6}
            value={content}
            disabled={busy}
            placeholder={t('placeholder.content')}
            onChange={(e) => setContent(e.target.value)}
            className={cn(INPUT, ring('content'))}
          />
        </div>
      )}
      {kind === 'faq' && (
        <>
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border bg-background p-2">
              <label htmlFor={f(`question-${i}`)} className="sr-only">
                {t('question')}
              </label>
              <input
                id={f(`question-${i}`)}
                value={r.question}
                maxLength={AIAG_SOURCE_LIMITS.question}
                disabled={busy}
                placeholder={t('placeholder.question')}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
                }
                className={cn(INPUT, ring(`question-${i}`))}
              />
              <label htmlFor={f(`answer-${i}`)} className="sr-only">
                {t('answer')}
              </label>
              <textarea
                id={f(`answer-${i}`)}
                rows={3}
                value={r.answer}
                maxLength={AIAG_SOURCE_LIMITS.answer}
                disabled={busy}
                placeholder={t('placeholder.answer')}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                }
                className={cn(INPUT, ring(`answer-${i}`))}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="text-[11.5px] text-danger underline"
                >
                  {t('faq.removeRow')}
                </button>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => setRows([...rows, { question: '', answer: '' }])}
          >
            {t('faq.addAnother')}
          </Button>
        </>
      )}
      {kind === 'file' && (
        <div>
          <label htmlFor={f('file')} className="sr-only">
            {t('file')}
          </label>
          <input
            id={f('file')}
            type="file"
            accept={FILE_ACCEPT}
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={cn('block w-full text-[12.5px]', ring('file'))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">{t('fileHint')}</p>
          {progress !== null && (
            <div
              role="progressbar"
              aria-label={t('uploading')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full bg-brand transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            abort.current?.abort();
            onCancel();
          }}
        >
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t(`submit.${kind}`)}
        </Button>
      </div>
    </form>
  );
}
