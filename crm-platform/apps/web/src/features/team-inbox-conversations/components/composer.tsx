'use client';

import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { MESSAGE_BODY_MAX, NOTE_BODY_MAX } from '@crm/contracts';
import { Button, Spinner, cn } from '@crm/ui';
import { humanSize } from '../lib/time';
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon } from './icons';

/** What the file picker offers; the server decides what it really accepts, by the file's bytes. */
const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

/** Drafts survive switching to another conversation and back (not a reload): the first thing an agent expects. */
const DRAFTS = new Map<string, string>();

export type ComposerMode = 'reply' | 'note';

export interface ComposerHandle {
  focus: () => void;
  /** Insert text at the caret (a quick reply, later). */
  insert: (text: string) => void;
}

export interface ComposerProps {
  conversationId: string;
  mode: ComposerMode;
  onMode: (mode: ComposerMode) => void;
  /** Why free-form replies are off (window closed, channel disconnected, no right): the explanation is shown above by the screen. */
  replyDisabled: boolean;
  canReply: boolean;
  canNote: boolean;
  canAttach: boolean;
  /** Reading only: neither tab can write. */
  onSend: (draft: { body: string; file: File | null }) => void;
  onNote: (body: string) => Promise<boolean>;
  handleRef?: Ref<ComposerHandle>;
}

/**
 * The message box. Enter sends, Shift+Enter is a new line (and Enter during an IME composition is left alone). Reply sends to the
 * customer; Internal note stays inside the workspace and keeps working when the 24 hour window is closed. A reply disabled by
 * the window or the channel says so on the box, never silently. The draft is cleared the moment it is sent: the bubble shows at
 * once in the thread and a failure keeps it there with a retry.
 */
export function Composer(props: ComposerProps) {
  const t = useTranslations('team-inbox-conversations.composer');
  const { conversationId, mode } = props;
  const [text, setText] = useState(() => DRAFTS.get(conversationId) ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Another conversation: its own draft (the previous one was saved as it was typed).
  const [seen, setSeen] = useState(conversationId);
  if (seen !== conversationId) {
    setSeen(conversationId);
    setText(DRAFTS.get(conversationId) ?? '');
    setFile(null);
    setFileError(null);
  }

  useImperativeHandle(props.handleRef, () => ({
    focus: () => area.current?.focus(),
    insert: (value: string) => {
      const el = area.current;
      const at = el?.selectionStart ?? text.length;
      const next = text.slice(0, at) + value + text.slice(el?.selectionEnd ?? at);
      setText(next);
      DRAFTS.set(conversationId, next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + value.length, at + value.length);
      });
    },
  }));

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text, mode]);

  const isNote = mode === 'note';
  const disabled = isNote ? !props.canNote : props.replyDisabled || !props.canReply;
  const max = isNote ? NOTE_BODY_MAX : MESSAGE_BODY_MAX;
  const trimmed = text.trim();
  const canSubmit = !disabled && !savingNote && (trimmed.length > 0 || (!isNote && file !== null));

  function change(value: string) {
    setText(value);
    if (value) DRAFTS.set(conversationId, value);
    else DRAFTS.delete(conversationId);
  }

  async function submit() {
    if (!canSubmit) return;
    if (isNote) {
      setSavingNote(true);
      const ok = await props.onNote(trimmed);
      setSavingNote(false);
      if (ok) change('');
      requestAnimationFrame(() => area.current?.focus());
      return;
    }
    props.onSend({ body: trimmed, file });
    change('');
    setFile(null);
    setFileError(null);
    if (input.current) input.current.value = '';
    requestAnimationFrame(() => area.current?.focus());
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFileError(null);
    setFile(f);
  }

  return (
    <div className="border-t border-border bg-background">
      <div role="tablist" aria-label={t('modeLabel')} className="flex items-center gap-1 px-3 pt-2">
        {(['reply', 'note'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            data-testid={`inbox-mode-${m}`}
            aria-selected={mode === m}
            onClick={() => {
              props.onMode(m);
              requestAnimationFrame(() => area.current?.focus());
            }}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary',
              mode === m
                ? m === 'note'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`mode.${m}`)}
          </button>
        ))}
      </div>

      {file && !isNote && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs">
          <FileIcon width={14} height={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate" data-testid="inbox-attachment-name">
            {file.name}
          </span>
          <span className="shrink-0 text-muted-foreground">{humanSize(file.size)}</span>
          <button
            type="button"
            aria-label={t('removeAttachment')}
            onClick={() => {
              setFile(null);
              if (input.current) input.current.value = '';
            }}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      )}
      {fileError && (
        <p role="alert" className="mx-3 mt-1 text-xs text-danger">
          {fileError}
        </p>
      )}

      <div className="flex items-end gap-2 p-3">
        {!isNote && props.canAttach && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              onChange={pick}
              className="sr-only"
              tabIndex={-1}
              data-testid="inbox-file-input"
              aria-label={t('attach')}
            />
            <button
              type="button"
              title={t('attach')}
              aria-label={t('attach')}
              disabled={disabled}
              onClick={() => input.current?.click()}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <PaperclipIcon />
            </button>
          </>
        )}
        <textarea
          ref={area}
          data-testid="inbox-composer"
          rows={1}
          dir="auto"
          value={text}
          maxLength={max}
          disabled={disabled}
          aria-label={isNote ? t('noteLabel') : t('replyLabel')}
          aria-describedby={hintId}
          placeholder={
            disabled && !isNote
              ? t('replyDisabledPlaceholder')
              : isNote
                ? t('notePlaceholder')
                : t('replyPlaceholder')
          }
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKey}
          className={cn(
            'max-h-36 min-h-10 w-full flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
            isNote ? 'border-warning/50 bg-warning/5' : 'border-border',
          )}
        />
        <Button
          data-testid="inbox-send"
          onClick={() => void submit()}
          disabled={!canSubmit}
          aria-label={isNote ? t('addNote') : t('send')}
          className="shrink-0 px-3"
        >
          {savingNote ? <Spinner /> : <SendIcon />}
          <span className="hidden sm:inline">{isNote ? t('addNote') : t('send')}</span>
        </Button>
      </div>
      <p id={hintId} className="px-3 pb-2 text-[11px] text-muted-foreground">
        {t('hint')}
      </p>
    </div>
  );
}
