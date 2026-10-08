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
const KINDS = ['url', 'text', 'qa', 'file'] as const;
type AddKind = (typeof KINDS)[number];

const STATE_PILL: Record<AiagSource['status'], { box: string; dot: string }> = {
  ready: { box: 'bg-emerald-100 text-emerald-900', dot: 'bg-emerald-500' },
  failed: { box: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  processing: { box: 'bg-muted text-muted-foreground', dot: 'bg-border' },
};

/**
 * Step 5, "Train the agent" (TW-AIAG-005..010): the four ways to add knowledge (a live URL, free text, a Q&A pair, a file) and the
 * list of entries with their state. A URL is read in the background, so the list asks again while one is `processing`.
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
            <div className="grid grid-cols-[80px_1fr_130px_44px] items-center gap-3 border-b border-border bg-muted/60 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <div>{t('col.kind')}</div>
              <div>{t('col.label')}</div>
              <div>{t('col.state')}</div>
              <div className="sr-only">{t('col.actions')}</div>
            </div>
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
  const pill = STATE_PILL[s.status];
  return (
    <li className="grid grid-cols-[80px_1fr_130px_44px] items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {t(`kind.${s.kind}`)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px]">
          {s.label}
          {s.assistantId === null && (
            <span className="ms-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[9.5px] uppercase text-muted-foreground">
              {t('workspaceWide')}
            </span>
          )}
        </div>
        {s.url && (
          <div className="truncate font-mono text-[11px] text-muted-foreground" dir="ltr">
            {s.url}
          </div>
        )}
        {s.tokensEstimate !== null && s.status === 'ready' && (
          <div className="font-mono text-[10px] text-muted-foreground">
            {t('tokens', { count: s.tokensEstimate })}
          </div>
        )}
      </div>
      <div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em]',
            pill.box,
          )}
        >
          {s.status === 'processing' ? (
            <Spinner />
          ) : (
            <span className={cn('size-1.5 rounded-full', pill.dot)} aria-hidden="true" />
          )}
          {t(`state.${s.status}`)}
        </span>
        {s.error && (
          <div className="mt-0.5 break-words text-[10px] text-danger" role="note">
            {s.error}
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
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
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
    if (label.trim() === '') return problem('label', 'label');
    if (kind === 'url' && url.trim() === '') return problem('url', 'url');
    if (kind === 'text' && content.trim() === '') return problem('content', 'content');
    if (kind === 'qa') {
      if (question.trim() === '') return problem('question', 'question');
      if (answer.trim() === '') return problem('answer', 'answer');
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
      } else {
        const body: AddAiagSourceInput =
          kind === 'url'
            ? { kind, label: label.trim(), url: url.trim() }
            : kind === 'text'
              ? { kind, label: label.trim(), content }
              : { kind: 'qa', label: label.trim(), question, answer };
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
      {kind === 'qa' && (
        <>
          <div>
            <label htmlFor={f('question')} className="sr-only">
              {t('question')}
            </label>
            <input
              id={f('question')}
              value={question}
              maxLength={AIAG_SOURCE_LIMITS.question}
              disabled={busy}
              placeholder={t('placeholder.question')}
              onChange={(e) => setQuestion(e.target.value)}
              className={cn(INPUT, ring('question'))}
            />
          </div>
          <div>
            <label htmlFor={f('answer')} className="sr-only">
              {t('answer')}
            </label>
            <textarea
              id={f('answer')}
              rows={3}
              value={answer}
              maxLength={AIAG_SOURCE_LIMITS.answer}
              disabled={busy}
              placeholder={t('placeholder.answer')}
              onChange={(e) => setAnswer(e.target.value)}
              className={cn(INPUT, ring('answer'))}
            />
          </div>
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
