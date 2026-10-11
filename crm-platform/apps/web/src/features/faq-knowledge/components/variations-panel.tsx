'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FAQ_LIMITS, type FaqEmbedState, type FaqVariationSource } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Spinner, Textarea, cn } from '@crm/ui';
import { errorKey, isEmbeddingUnavailable } from '../lib/errors';
import { parseVariationLines, variationKey, variationRoom } from '../lib/model';
import { CheckIcon, EditIcon, LockIcon, SparkIcon, TrashIcon, WarnIcon } from './icons';
import { CARD, focusAfterRemoval } from './parts';

export interface VariationRow {
  /** React key: the uuid once saved, the text before. */
  key: string;
  id?: string;
  text: string;
  source: FaqVariationSource;
  /** Absent before the FAQ is saved (nothing is indexed yet). */
  embedState?: FaqEmbedState;
  embedError?: string | null;
  rowVersion?: number;
}

export interface VariationsPanelProps {
  question: string;
  rows: VariationRow[];
  /** `maxVariationsPerFaq` of the workspace (the question counts). Null while settings load. */
  max: number | null;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onAdd: (texts: string[], source: 'manual' | 'ai') => Promise<void>;
  onEdit: (row: VariationRow, text: string) => Promise<void>;
  onRemove: (row: VariationRow) => Promise<void>;
  /** Null when suggestions cannot be asked for yet (the FAQ is not saved). */
  onSuggest: (() => Promise<string[]>) | null;
}

/**
 * The right panel of the editor: every phrasing that should reach this FAQ, each with whether it is live yet. The question itself is
 * first and locked. Adding is one by one or pasted in bulk with a preview; AI suggestions are only proposals until picked.
 */
export function VariationsPanel(p: VariationsPanelProps) {
  const t = useTranslations('faq.variations');
  const [text, setText] = useState('');
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<VariationRow | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const question = p.rows.find((r) => r.source === 'question');
  const others = p.rows.filter((r) => r.source !== 'question');
  const count = others.length + 1;
  const existing = useMemo(() => [p.question, ...p.rows.map((r) => r.text)], [p.question, p.rows]);
  const room = p.max === null ? FAQ_LIMITS.variationsPerRequest : variationRoom(count, p.max);
  const full = p.max !== null && count >= p.max;
  const batch = useMemo(
    () => parseVariationLines(bulkText, existing, room),
    [bulkText, existing, room],
  );

  const guard = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addOne = async () => {
    const batchOne = parseVariationLines(text, existing, room);
    if (batchOne.fresh.length === 0) {
      setError(
        batchOne.duplicates.length > 0
          ? 'duplicate'
          : batchOne.tooLong.length > 0
            ? 'tooLong'
            : null,
      );
      return;
    }
    if (await guard(() => p.onAdd(batchOne.fresh, 'manual'))) {
      setText('');
      addRef.current?.focus();
    }
  };

  const addBulk = async () => {
    if (batch.fresh.length === 0) return;
    if (await guard(() => p.onAdd(batch.fresh, 'manual'))) {
      setBulkText('');
      setBulk(false);
    }
  };

  const suggest = async () => {
    if (!p.onSuggest) return;
    setSuggesting(true);
    setError(null);
    try {
      const list = await p.onSuggest();
      setSuggestions(list);
      setPicked(new Set(list));
    } catch (e) {
      setError(e);
    } finally {
      setSuggesting(false);
    }
  };

  const addPicked = async () => {
    const texts = (suggestions ?? []).filter((s) => picked.has(s));
    if (texts.length === 0) return;
    if (await guard(() => p.onAdd(texts, 'ai'))) {
      setSuggestions(null);
      setPicked(new Set());
    }
  };

  const saveEdit = async (row: VariationRow) => {
    const next = draft.trim();
    if (next === '' || next === row.text) {
      setEditing(null);
      return;
    }
    if (
      variationKey(next) !== variationKey(row.text) &&
      existing.some((x) => variationKey(x) === variationKey(next))
    ) {
      setError('duplicate');
      return;
    }
    if (await guard(() => p.onEdit(row, next))) setEditing(null);
  };

  const onEditKey = (e: KeyboardEvent, row: VariationRow) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveEdit(row);
    } else if (e.key === 'Escape') {
      setEditing(null);
    }
  };

  const failedCount = others.filter((r) => r.embedState === 'failed').length;

  return (
    <section aria-labelledby="faq-var-title" className={cn(CARD, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <div>
          <h2 id="faq-var-title" tabIndex={-1} className="text-sm font-semibold outline-none">
            {t('title')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums',
            full ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
          )}
          aria-label={p.max === null ? undefined : t('counterLabel', { count, max: p.max })}
        >
          {p.max === null ? count : `${count} / ${p.max}`}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {error !== null && <VariationError error={error} />}
        {failedCount > 0 && (
          <Alert tone="warning">{t('failedNotice', { count: failedCount })}</Alert>
        )}

        <ol className="space-y-2" aria-label={t('listLabel')}>
          <li className="flex items-center gap-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
            <LockIcon className="text-muted-foreground" />
            <span className="min-w-0 flex-1 break-words text-sm">
              {p.question.trim() === '' ? (
                <span className="text-muted-foreground">{t('questionEmpty')}</span>
              ) : (
                p.question
              )}
            </span>
            <Badge>{t('source.question')}</Badge>
            {question && <IndexState row={question} />}
          </li>
          {others.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              {editing === row.key ? (
                <>
                  <input
                    autoFocus
                    aria-label={t('editLabel')}
                    value={draft}
                    maxLength={FAQ_LIMITS.variation}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onEditKey(e, row)}
                    className="h-9 min-w-40 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <Button size="sm" onClick={() => void saveEdit(row)} disabled={busy}>
                    {busy && <Spinner />}
                    {t('save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm">{row.text}</span>
                  <Badge>{t(`source.${row.source}`)}</Badge>
                  <IndexState row={row} />
                  {p.canEdit && row.id && (
                    <IconButton
                      label={t('edit', { text: row.text })}
                      onClick={() => {
                        setEditing(row.key);
                        setDraft(row.text);
                        setError(null);
                      }}
                    >
                      <EditIcon />
                    </IconButton>
                  )}
                  {(row.id ? p.canDelete : true) && (
                    <IconButton
                      label={t('remove', { text: row.text })}
                      danger
                      onClick={() => {
                        if (row.id) setRemoving(row);
                        else
                          void guard(() => p.onRemove(row)).then(() =>
                            focusAfterRemoval('faq-var-add'),
                          );
                      }}
                    >
                      <TrashIcon />
                    </IconButton>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
        {others.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}

        {p.canAdd && (
          <div className="space-y-3 border-t border-border pt-4">
            {full ? (
              <Alert tone="warning">{t('full', { max: p.max ?? 0 })}</Alert>
            ) : bulk ? (
              <div className="space-y-2">
                <label htmlFor="faq-var-bulk" className="block text-sm font-medium">
                  {t('bulk.label')}
                </label>
                <Textarea
                  id="faq-var-bulk"
                  rows={6}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={t('bulk.placeholder')}
                />
                <BulkPreview batch={batch} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void addBulk()}
                    disabled={busy || batch.fresh.length === 0}
                  >
                    {busy && <Spinner />}
                    {t('bulk.add', { count: batch.fresh.length })}
                  </Button>
                  <Button variant="ghost" onClick={() => setBulk(false)}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              // Not a <form>: this panel sits inside the editor's own form, and forms cannot nest (Enter here adds the phrasing).
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('addLabel')}>
                <label htmlFor="faq-var-add" className="sr-only">
                  {t('addLabel')}
                </label>
                <input
                  id="faq-var-add"
                  ref={addRef}
                  value={text}
                  maxLength={FAQ_LIMITS.variation}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!busy && text.trim() !== '') void addOne();
                    }
                  }}
                  placeholder={t('addPlaceholder')}
                  className="h-10 min-w-40 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || text.trim() === ''}
                  onClick={() => void addOne()}
                >
                  {busy && <Spinner />}
                  {t('add')}
                </Button>
                <Button variant="ghost" onClick={() => setBulk(true)}>
                  {t('pasteMany')}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Button
                variant="secondary"
                onClick={() => void suggest()}
                disabled={!p.onSuggest || suggesting || full || p.question.trim() === ''}
              >
                {suggesting ? <Spinner /> : <SparkIcon />}
                {t('suggest')}
              </Button>
              {!p.onSuggest && (
                <p className="text-xs text-muted-foreground">{t('suggestSaveFirst')}</p>
              )}
              <p role="status" className="sr-only">
                {suggesting
                  ? t('suggesting')
                  : suggestions
                    ? t('suggestionsReady', { count: suggestions.length })
                    : ''}
              </p>
            </div>

            {suggestions && (
              <fieldset className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">{t('suggestionsTitle')}</legend>
                {suggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('suggestionsNone')}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{t('suggestionsHint')}</p>
                    <ul className="space-y-1.5">
                      {suggestions.map((s, i) => (
                        <li key={s}>
                          <Checkbox
                            id={`faq-sugg-${i}`}
                            label={s}
                            checked={picked.has(s)}
                            onChange={(e) =>
                              setPicked((cur) => {
                                const n = new Set(cur);
                                if (e.target.checked) n.add(s);
                                else n.delete(s);
                                return n;
                              })
                            }
                          />
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void addPicked()} disabled={busy || picked.size === 0}>
                        {busy && <Spinner />}
                        {t('addSelected', { count: picked.size })}
                      </Button>
                      <Button variant="ghost" onClick={() => setSuggestions(null)}>
                        {t('discard')}
                      </Button>
                    </div>
                  </>
                )}
              </fieldset>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        tone="danger"
        busy={busy}
        title={t('confirm.title')}
        message={t('confirm.body', { text: removing?.text ?? '' })}
        confirmLabel={t('confirm.remove')}
        cancelLabel={t('cancel')}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const row = removing;
          if (!row) return;
          void guard(() => p.onRemove(row)).then((ok) => {
            setRemoving(null);
            if (ok) focusAfterRemoval('faq-var-add');
          });
        }}
      />
    </section>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary',
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Pending spinner, ready check or failed warning; always a word as well, and the failure reason in the tooltip. */
export function IndexState({ row }: { row: Pick<VariationRow, 'embedState' | 'embedError'> }) {
  const t = useTranslations('faq.variations.state');
  if (!row.embedState) return null;
  if (row.embedState === 'ready')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckIcon className="size-3.5" />
        {t('ready')}
      </span>
    );
  if (row.embedState === 'pending')
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
        title={t('pendingHint')}
      >
        <Spinner />
        {t('pending')}
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-danger"
      title={`${row.embedError ?? t('noReason')}. ${t('failedHint')}`}
    >
      <WarnIcon className="size-3.5" />
      {t('failed')}
      <span className="sr-only">
        {row.embedError ?? t('noReason')}. {t('failedHint')}
      </span>
    </span>
  );
}

function BulkPreview({ batch }: { batch: ReturnType<typeof parseVariationLines> }) {
  const t = useTranslations('faq.variations.bulk');
  return (
    <div role="status" className="space-y-1 rounded-md bg-muted/50 p-3 text-xs">
      <p className="font-medium">{t('summary', { count: batch.fresh.length })}</p>
      {batch.duplicates.length > 0 && (
        <p className="text-muted-foreground">
          {t('duplicates', { count: batch.duplicates.length })}
        </p>
      )}
      {batch.tooLong.length > 0 && (
        <p className="text-warning">
          {t('tooLong', { count: batch.tooLong.length, max: FAQ_LIMITS.variation })}
        </p>
      )}
      {batch.overflow.length > 0 && (
        <p className="text-warning">{t('overflow', { count: batch.overflow.length })}</p>
      )}
      {batch.fresh.length > 0 && (
        <ul className="mt-1 max-h-32 list-inside list-disc overflow-auto text-muted-foreground">
          {batch.fresh.slice(0, 20).map((f) => (
            <li key={f}>{f}</li>
          ))}
          {batch.fresh.length > 20 && <li>{t('more', { count: batch.fresh.length - 20 })}</li>}
        </ul>
      )}
    </div>
  );
}

function VariationError({ error }: { error: unknown }) {
  const t = useTranslations('faq.variations');
  const te = useTranslations('faq.errors');
  if (error === 'duplicate') return <Alert tone="warning">{t('errors.duplicate')}</Alert>;
  if (error === 'tooLong')
    return <Alert tone="warning">{t('errors.tooLong', { max: FAQ_LIMITS.variation })}</Alert>;
  return (
    <Alert tone="danger">
      <p>{te(errorKey(error))}</p>
      {isEmbeddingUnavailable(error) && (
        <p className="mt-1">
          <Link href="/ai-keys" className="font-medium underline underline-offset-2">
            {t('errors.aiKeys')}
          </Link>
        </p>
      )}
    </Alert>
  );
}
