'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, cn } from '@crm/ui';
import type { TchatMessageResponse } from '@crm/contracts';
import { TCHAT_ATTACHMENT_MAX_BYTES, TCHAT_MESSAGE_MAX } from '@crm/contracts';
import { plainBody } from '../lib/body';
import { humanSize } from '../lib/format';
import {
  detectMention,
  filterMentionable,
  insertMention,
  moveIndex,
  type Mentionable,
} from '../lib/mention';
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon } from './icons';
import { Avatar } from './parts';

/** What the file picker offers (WaDesk's list); the server decides what it really accepts, by the file's bytes. */
const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';
const TYPING_EVERY_MS = 3_000;

export interface ComposerProps {
  channelName: string;
  people: Mentionable[];
  meId: string;
  replyTo: TchatMessageResponse | null;
  onCancelReply: () => void;
  file: File | null;
  onFile: (file: File | null) => void;
  /** Text to put at the caret (a member clicked in the rail). `nonce` makes the same text insertable twice. */
  insertion: { text: string; nonce: number } | null;
  onSend: (draft: { body: string; replyToId: string | null; file: File | null }) => void;
  onTyping: () => void;
  typingNames: string[];
  disabled?: boolean;
}

/**
 * The message box: growing text, `@` picker, one attachment, the reply banner. Enter sends, Shift+Enter is a new line, Escape
 * closes the picker and then the reply. Empty text with no file is ignored; the draft is cleared the moment it is sent (the
 * message shows at once, in the stream, and a failure keeps it there with a retry).
 */
export function Composer(props: ComposerProps) {
  const t = useTranslations('team-chat.composer');
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [pickerOff, setPickerOff] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const listId = useId();

  const mention = pickerOff ? null : detectMention(text, caret);
  const options = mention ? filterMentionable(props.people, mention.query, props.meId) : [];
  const open = mention !== null && options.length > 0;
  const active = Math.min(pick, Math.max(0, options.length - 1));

  // Grow with the text, up to 180 px.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // A reply starts here: put the caret in the box.
  useEffect(() => {
    if (props.replyTo) area.current?.focus();
  }, [props.replyTo]);

  // A member clicked in the rail: their token goes at the caret.
  const seen = useRef(0);
  useEffect(() => {
    const ins = props.insertion;
    if (!ins || ins.nonce === seen.current) return;
    seen.current = ins.nonce;
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + ins.text + text.slice(at);
    setText(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      const pos = at + ins.text.length;
      el?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
    // Runs once per nonce; the text it reads is the latest at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.insertion]);

  const submit = () => {
    const body = text.trim();
    if (!body && !props.file) return;
    props.onSend({ body, replyToId: props.replyTo?.id ?? null, file: props.file });
    setText('');
    setCaret(0);
    props.onFile(null);
    props.onCancelReply();
    setFileError(null);
  };

  const choose = (index: number) => {
    const person = options[index];
    if (!person || !mention) return;
    const el = area.current;
    const next = insertMention(text, mention.start, el?.selectionStart ?? caret, person);
    setText(next.text);
    setCaret(next.caret);
    setPick(0);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick(moveIndex(active, options.length, e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerOff(true);
        return;
      }
    }
    if (e.key === 'Escape' && props.replyTo) {
      props.onCancelReply();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (value: string, at: number) => {
    setText(value);
    setCaret(at);
    setPick(0);
    setPickerOff(false);
    const now = Date.now();
    if (value && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now;
      props.onTyping();
    }
  };

  const takeFile = (file: File | null) => {
    if (file && file.size > TCHAT_ATTACHMENT_MAX_BYTES) {
      setFileError(t('fileTooLarge'));
      return;
    }
    setFileError(null);
    props.onFile(file);
  };

  const typing = props.typingNames;
  const canSend = (text.trim().length > 0 || props.file !== null) && !props.disabled;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative space-y-2 border-t border-border bg-background px-4 py-3"
    >
      <p aria-live="polite" className="h-4 text-xs text-muted-foreground">
        {typing.length === 1
          ? t('typingOne', { name: typing[0]! })
          : typing.length > 1
            ? t('typingMany', { count: typing.length })
            : ''}
      </p>

      {props.replyTo && (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-1.5 text-[11.5px]">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t('replyingTo', { name: props.replyTo.authorName })}</div>
            <div className="truncate text-muted-foreground">
              {plainBody(props.replyTo.body ?? props.replyTo.attachment?.name ?? '').slice(0, 80)}
            </div>
          </div>
          <button
            type="button"
            aria-label={t('cancelReply')}
            onClick={props.onCancelReply}
            className="rounded p-0.5 hover:bg-border"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {props.file && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-xs">
          <FileIcon />
          <span className="truncate font-medium">{props.file.name}</span>
          <span className="text-muted-foreground">{humanSize(props.file.size)}</span>
          <button
            type="button"
            aria-label={t('removeFile')}
            onClick={() => takeFile(null)}
            className="ms-auto rounded p-0.5 hover:bg-border"
          >
            <CloseIcon />
          </button>
        </div>
      )}
      {fileError && (
        <p role="alert" className="text-xs text-danger">
          {fileError}
        </p>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('mentionList')}
          className="absolute bottom-full start-4 z-20 mb-1 max-h-60 w-[min(18rem,calc(100%-2rem))] overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg"
        >
          {options.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              // The mouse picks without taking focus from the box, so the caret stays where it was.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                i === active && 'bg-muted',
              )}
            >
              <Avatar id={p.id} name={p.name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            takeFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <textarea
          ref={area}
          value={text}
          rows={1}
          maxLength={TCHAT_MESSAGE_MAX}
          aria-label={t('placeholder', { name: props.channelName })}
          placeholder={t('placeholder', { name: props.channelName })}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const f = e.clipboardData.files[0];
            if (f) {
              e.preventDefault();
              takeFile(f);
            }
          }}
          className="max-h-45 min-h-9 flex-1 resize-none rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px] outline-none focus:border-primary focus:bg-background"
        />
        <Button
          variant="ghost"
          className="size-9 shrink-0 rounded-full px-0 text-muted-foreground"
          aria-label={t('attach')}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Button
          type="submit"
          className="h-9 shrink-0 rounded-full px-4 text-[12.5px]"
          disabled={!canSend}
        >
          <SendIcon />
          {t('send')}
        </Button>
      </div>
      <p className="hidden font-mono text-[10px] text-muted-foreground sm:block">
        <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5">↵</kbd>{' '}
        {t('hintSend')}
        {' · '}
        <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5">
          {t('hintShift')}
        </kbd>{' '}
        {t('hintNewLine')}
        {' · '}
        <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5">@</kbd>{' '}
        {t('hintMention')}
      </p>
    </form>
  );
}
