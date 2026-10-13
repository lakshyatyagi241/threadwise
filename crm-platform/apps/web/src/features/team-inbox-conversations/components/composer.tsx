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
  type DragEvent,
  type Ref,
} from 'react';
import {
  EMAIL_HTML_MAX,
  MESSAGE_BODY_MAX,
  NOTE_BODY_MAX,
  type MessageResponse,
  type WaGroupMention,
} from '@crm/contracts';
import {
  AttachmentHints,
  acceptAttribute,
  checkAttachment,
  hasWhatsappLimits,
  useAttachmentError,
} from '@/features/channel-whatsapp-cloud';
import { Button, Spinner, cn } from '@crm/ui';
import type { EmailReplyExtras } from '@crm/contracts';
import { EmailExtrasFields } from '@/features/channel-email/components/extras-fields';
import {
  EMAIL_BODY_MAX,
  EMPTY_EXTRAS,
  buildExtras,
  type ExtrasDraft,
} from '@/features/channel-email/lib/composer-extras';
import { AttachmentTray } from '@/features/channel-email/components/attachment-tray';
import {
  RichEditor,
  plainFromHtml,
  type RichEditorHandle,
} from '@/features/channel-email/components/rich-editor';
import { SignaturePicker } from '@/features/channel-email/components/signature-picker';
import {
  EmailComposerFooter,
  EmailEditorHint,
  EmailSendProblem,
} from '@/features/channel-email/components/composer-notes';
import { htmlToText, isBlankHtml, textToHtml } from '@/features/channel-email/lib/rich-text';
import {
  AUTO_SIGNATURE,
  signatureExtras,
  type SignatureChoice,
} from '@/features/channel-email/lib/signature-view';
import { useStagedAttachments } from '@/features/channel-email/lib/use-staged-attachments';
import {
  activeMention,
  insertMention,
  prepareMentions,
  type MentionMember,
  type PickedMention,
} from '../lib/mentions';
import { humanSize } from '../lib/time';
import { insertReply } from '../lib/saved-replies';
import { MentionList, useMentionSearch } from './mention-picker';
import {
  CloseIcon,
  FileIcon,
  PaperclipIcon,
  SavedReplyIcon,
  SendIcon,
  ShareIcon,
  SmileIcon,
  TemplateIcon,
} from './icons';
import { EmojiPicker } from './emoji-picker';
import { QuotePreview } from './quote-preview';
import {
  SavedReplyPicker,
  type PickerState,
  type SavedReplyPickerHandle,
} from './saved-reply-picker';

/** The longest rich-text body the reply takes (the contract's cap on `bodyHtml`). */
const EMAIL_HTML_LIMIT = EMAIL_HTML_MAX * 2;

/** What the file picker offers; the server decides what it really accepts, by the file's bytes. */
const ACCEPT = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv';

/** What the channel takes as an attachment: only a channel with WhatsApp's rules is checked here (the server checks the rest). */
export interface AttachmentRules {
  channelKind: string;
  /** The channel's media capability. */
  allowed: readonly string[];
}

/** Stands in for the member search when a thread has none (the hook is always called; it asks nothing for a `null` query). */
const NO_SEARCH = async (): Promise<MentionMember[]> => [];

/** Drafts survive switching to another conversation and back (not a reload): the first thing an agent expects. */
const DRAFTS = new Map<string, string>();
/** The same for the rich-text draft of an email reply (HTML the editor produced). */
const HTML_DRAFTS = new Map<string, string>();

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
  /** A WhatsApp group thread: sending is not available yet, so the Reply tab can neither type, attach, pick a template nor send. */
  groupSendBlocked?: boolean;
  /** Why a Cloud API group is blocked (suspended, plan, not eligible): replaces the generic "not available" line under the box. */
  groupBlockedHint?: string;
  /** The channel sends templates and the agent may reply: the "Template" button is shown (it works with the window closed). */
  canTemplate?: boolean;
  /** Opens the template picker. */
  onTemplate?: () => void;
  /** The channel carries a place, contact cards or buttons and the agent may reply: the "Share" button is shown. */
  canShare?: boolean;
  /** Opens the share dialog. */
  onShare?: () => void;
  /** The type and size rules of the channel, so a file WhatsApp would refuse is turned away before it is uploaded. */
  attachments?: AttachmentRules;
  /**
   * The agent may reply: the saved-reply picker is offered (the "Saved replies" button and `/` in the box). `channelKind` leaves out the
   * replies that are restricted to other channels. Left out, the box has no picker.
   */
  savedReplies?: { channelKind?: string };
  /**
   * An email conversation: the box adds Cc, Bcc and a subject, takes a long body and drops what email cannot carry (emoji). The
   * subject placeholder is `Re: <subject>` of the thread.
   */
  email?: {
    defaultSubject: string;
    /** The inbox channel of the conversation: names the mailbox, so the signature picker can list its signatures. */
    channelId?: string;
    /** The last email send that was refused, shown above the box (a rate limit says when to try again). */
    sendProblem?: { code: string; retryAfterS?: number } | null;
  };
  /**
   * A group of a personal (linked) number: typing `@` opens a list of its members (`search` asks the API by name or number) and a
   * picked member is sent as a mention. Left out everywhere else, so no other thread ever opens a member list.
   */
  groupMentions?: { search: (q: string) => Promise<MentionMember[]> };
  /** Reading only: neither tab can write. */
  onSend: (draft: {
    body: string;
    file: File | null;
    email?: EmailReplyExtras;
    mentions?: WaGroupMention[];
  }) => void;
  /** The message the next send answers (shown above the box); the screen clears it after a send. */
  replyTo?: MessageResponse | null;
  onCancelReply?: () => void;
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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [extras, setExtras] = useState<ExtrasDraft>(EMPTY_EXTRAS);
  const [extrasTried, setExtrasTried] = useState(false);
  const [html, setHtml] = useState(() => HTML_DRAFTS.get(conversationId) ?? '');
  const [rich, setRich] = useState(true);
  const [editorKey, setEditorKey] = useState(0);
  const [signature, setSignature] = useState<SignatureChoice>(AUTO_SIGNATURE);
  const [dragging, setDragging] = useState(false);
  const [bodyTooLong, setBodyTooLong] = useState(false);
  const [picker, setPicker] = useState<PickerState>({
    open: false,
    listId: '',
    activeId: undefined,
  });
  const [unfilled, setUnfilled] = useState<string[]>([]);
  const pickerRef = useRef<SavedReplyPickerHandle>(null);
  const staged = useStagedAttachments(conversationId);
  const editor = useRef<RichEditorHandle>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const attachmentError = useAttachmentError();
  // The newest text, for an insert that finishes after a round trip to the server.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });
  // @mentions (personal-number groups): the member picked for each `@Name` in the box, and the `@` the caret is in right now.
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionSearch = props.groupMentions?.search;
  const limited =
    props.attachments && hasWhatsappLimits(props.attachments.channelKind)
      ? props.attachments
      : null;
  const accept = limited ? acceptAttribute(limited.allowed) || ACCEPT : ACCEPT;

  // Another conversation: its own draft (the previous one was saved as it was typed).
  const [seen, setSeen] = useState(conversationId);
  if (seen !== conversationId) {
    setSeen(conversationId);
    setText(DRAFTS.get(conversationId) ?? '');
    setFile(null);
    setFileError(null);
    setEmojiOpen(false);
    setExtras(EMPTY_EXTRAS);
    setExtrasTried(false);
    setHtml(HTML_DRAFTS.get(conversationId) ?? '');
    setEditorKey((k) => k + 1);
    setSignature(AUTO_SIGNATURE);
    setBodyTooLong(false);
    setUnfilled([]);
    setPicked([]);
    setMention(null);
  }

  const richEmail = props.email !== undefined && mode === 'reply' && rich;

  useImperativeHandle(props.handleRef, () => ({
    focus: () => (richEmail ? editor.current?.focus() : area.current?.focus()),
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

  // Starting a reply puts the caret in the box.
  const replyId = props.replyTo?.id;
  useEffect(() => {
    if (replyId) area.current?.focus();
  }, [replyId]);

  // Grow with the text, up to about six lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text, mode]);

  const isNote = mode === 'note';
  const groupBlocked = !isNote && props.groupSendBlocked === true;
  const disabled = isNote ? !props.canNote : props.replyDisabled || !props.canReply || groupBlocked;
  const isEmail = props.email !== undefined;
  // The picker's button also works in the rich email editor (it types the text at the caret); the `/` shortcut is the plain box's.
  const showSavedReplies = props.savedReplies !== undefined && !isNote && !groupBlocked;
  const typed = richEmail ? plainFromHtml(html) : text;
  const stillUnfilled = unfilled.filter((token) => typed.includes(token));
  const max = isNote ? NOTE_BODY_MAX : isEmail ? EMAIL_BODY_MAX : MESSAGE_BODY_MAX;
  const trimmed = text.trim();
  const emailBlocked = isEmail && !isNote && (staged.uploading || staged.failed);
  const emailBodyBlank = richEmail ? isBlankHtml(html) : trimmed.length === 0;
  const mentionOn =
    mentionSearch !== undefined && !isNote && !disabled && !isEmail && !groupBlocked;
  const found = useMentionSearch(
    mentionSearch ?? NO_SEARCH,
    mentionOn && mention ? mention.query : null,
  );
  const mentionOpen = mentionOn && mention !== null;
  const canSubmit =
    !disabled &&
    !savingNote &&
    (isEmail && !isNote
      ? !emailBodyBlank && !emailBlocked
      : trimmed.length > 0 || (!isNote && file !== null));

  function change(value: string) {
    setText(value);
    if (value) DRAFTS.set(conversationId, value);
    else DRAFTS.delete(conversationId);
  }

  /** Puts a filled-in saved reply in the box (never sends it): in place of the typed `/query`, or at the caret. False when it does not fit. */
  function insertSavedReply(reply: string, range: { start: number; end: number } | null): boolean {
    if (richEmail) {
      editor.current?.insertText(reply);
      return true;
    }
    const el = area.current;
    const at = range ?? {
      start: el?.selectionStart ?? textRef.current.length,
      end: el?.selectionEnd ?? textRef.current.length,
    };
    const done = insertReply(textRef.current, at, reply, max);
    if (!done) return false;
    change(done.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(done.caret, done.caret);
    });
    return true;
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
    let emailExtras: EmailReplyExtras | undefined;
    let body = trimmed;
    if (isEmail) {
      const built = buildExtras(extras);
      if (Object.keys(built.problems).length > 0) {
        // Keep the draft: the fields say what to fix.
        setExtrasTried(true);
        return;
      }
      if (richEmail && html.length > EMAIL_HTML_LIMIT) {
        setBodyTooLong(true);
        return;
      }
      setBodyTooLong(false);
      if (richEmail) body = htmlToText(html);
      emailExtras = {
        cc: [],
        bcc: [],
        ...built.extras,
        ...(richEmail ? { bodyHtml: html } : {}),
        ...(staged.ids.length > 0 ? { attachmentIds: staged.ids } : {}),
        ...signatureExtras(signature),
      };
    }
    // A mention rides only with text: a file's caption keeps the `@Name` as typed.
    const mentioned =
      mentionOn && !file && picked.length > 0 ? prepareMentions(body, picked) : null;
    props.onSend({
      body: mentioned ? mentioned.body : body,
      file: isEmail ? null : file,
      ...(emailExtras ? { email: emailExtras } : {}),
      ...(mentioned && mentioned.mentions.length > 0 ? { mentions: mentioned.mentions } : {}),
    });
    setPicked([]);
    setMention(null);
    setExtras(EMPTY_EXTRAS);
    setExtrasTried(false);
    setUnfilled([]);
    pickerRef.current?.close();
    if (isEmail) {
      HTML_DRAFTS.delete(conversationId);
      setHtml('');
      setEditorKey((k) => k + 1);
      staged.clear();
      setSignature(AUTO_SIGNATURE);
    }
    change('');
    setFile(null);
    setFileError(null);
    if (input.current) input.current.value = '';
    requestAnimationFrame(() => (richEmail ? editor.current?.focus() : area.current?.focus()));
  }

  function changeHtml(value: string) {
    setHtml(value);
    if (value) HTML_DRAFTS.set(conversationId, value);
    else HTML_DRAFTS.delete(conversationId);
  }

  /** Rich text and plain text keep one draft: switching carries it across. */
  function toggleRich() {
    if (rich) change(htmlToText(html));
    else changeHtml(textToHtml(text));
    setRich(!rich);
    setEditorKey((k) => k + 1);
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  /** Where the caret is decides whether the member list is open: right after an `@` typed at the start or after a space. */
  function syncMention(el: HTMLTextAreaElement) {
    if (!mentionOn) return;
    const next = activeMention(el.value, el.selectionStart ?? el.value.length);
    if (next === null) {
      if (mention !== null) setMention(null);
    } else if (!mention || mention.start !== next.start || mention.query !== next.query) {
      setMention(next);
      setMentionIndex(0);
    }
  }

  function pickMention(member: MentionMember) {
    const el = area.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? text.length;
    const done = insertMention(text, mention.start, caret, member);
    change(done.text);
    setPicked((cur) => [...cur.filter((p) => p.jid !== done.picked.jid), done.picked]);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(done.caret, done.caret);
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An open saved-reply list owns the arrows, Enter, Tab and Escape.
    if (pickerRef.current?.keyDown(e)) return;
    if (mentionOpen && !e.nativeEvent.isComposing) {
      const list = found.items;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.length > 0) {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setMentionIndex((i) => (i + step + list.length) % list.length);
        }
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && list.length > 0 && !e.shiftKey) {
        e.preventDefault();
        pickMention(list[Math.min(mentionIndex, list.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && !isNote && props.replyTo) {
      e.preventDefault();
      props.onCancelReply?.();
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFileError(null);
    if (f && limited) {
      const check = checkAttachment(f, limited.allowed);
      if (!check.ok) {
        setFileError(attachmentError(check));
        setFile(null);
        e.target.value = '';
        return;
      }
    }
    setFile(f);
  }

  function addEmoji(emoji: string) {
    const el = area.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + emoji + text.slice(el?.selectionEnd ?? at);
    if (next.length > max) return;
    change(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + emoji.length, at + emoji.length);
    });
  }

  return (
    <div
      className={cn(
        'relative border-t border-border bg-background',
        dragging && 'outline outline-2 -outline-offset-2 outline-primary',
      )}
      onDragOver={
        isEmail && !isNote && !disabled
          ? (e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={isEmail ? () => setDragging(false) : undefined}
      onDrop={
        isEmail && !isNote && !disabled
          ? (e) => {
              if (!hasFiles(e)) return;
              e.preventDefault();
              setDragging(false);
              staged.add(Array.from(e.dataTransfer.files));
            }
          : undefined
      }
    >
      {mentionOpen && (
        <MentionList
          items={found.items}
          loading={found.loading}
          active={Math.min(mentionIndex, Math.max(0, found.items.length - 1))}
          onPick={pickMention}
        />
      )}
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

      {props.replyTo && !isNote && !groupBlocked && (
        <div
          data-testid="inbox-reply-bar"
          className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5"
        >
          <QuotePreview message={props.replyTo} variant="composer" className="min-w-0 flex-1" />
          <button
            type="button"
            data-testid="inbox-reply-cancel"
            aria-label={t('cancelReply')}
            title={t('cancelReply')}
            onClick={props.onCancelReply}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      )}

      {file && !isNote && !groupBlocked && (
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
      {!isNote && stillUnfilled.length > 0 && (
        <p
          role="status"
          data-testid="inbox-saved-reply-notice"
          className="mx-3 mt-1 text-xs text-warning"
        >
          {t('savedReplyIssues', { count: stillUnfilled.length, list: stillUnfilled.join(', ') })}
        </p>
      )}

      {isEmail && !isNote && !groupBlocked && (
        <AttachmentTray
          files={staged.files}
          refusals={staged.refusals}
          onRemove={staged.remove}
          onRetry={staged.retry}
          onDismissRefusals={staged.dismissRefusals}
        />
      )}
      {isEmail && !isNote && !groupBlocked && (
        <EmailSendProblem problem={props.email?.sendProblem ?? null} bodyTooLong={bodyTooLong} />
      )}
      {isEmail && !isNote && !groupBlocked && (
        <EmailExtrasFields
          value={extras}
          onChange={setExtras}
          defaultSubject={props.email?.defaultSubject ?? ''}
          showProblems={extrasTried}
          disabled={disabled}
        />
      )}

      <div className="relative flex items-end gap-2 p-3">
        {showSavedReplies && (
          <SavedReplyPicker
            key={conversationId}
            conversationId={conversationId}
            channelKind={props.savedReplies?.channelKind}
            handleRef={pickerRef}
            onInsert={insertSavedReply}
            onIssues={(issues) => setUnfilled(issues.map((i) => i.token))}
            onClosed={() => (richEmail ? editor.current?.focus() : area.current?.focus())}
            onState={setPicker}
          />
        )}
        {!isNote && !groupBlocked && props.canTemplate && props.onTemplate && (
          <button
            type="button"
            title={t('template')}
            aria-label={t('template')}
            data-testid="inbox-template-button"
            onClick={props.onTemplate}
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            <TemplateIcon />
          </button>
        )}
        {!isNote && !groupBlocked && props.canShare && props.onShare && (
          <button
            type="button"
            title={t('share.open')}
            aria-label={t('share.open')}
            data-testid="inbox-share-button"
            disabled={disabled}
            onClick={props.onShare}
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <ShareIcon />
          </button>
        )}
        {!isNote && !groupBlocked && props.canAttach && isEmail && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              onChange={(e) => {
                staged.add(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
              className="sr-only"
              tabIndex={-1}
              data-testid="email-file-input"
              aria-label={t('attach')}
            />
            <button
              type="button"
              title={t('attach')}
              aria-label={t('attach')}
              data-testid="email-attach-button"
              disabled={disabled}
              onClick={() => input.current?.click()}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <PaperclipIcon />
            </button>
          </>
        )}
        {!isNote && !groupBlocked && props.canAttach && !isEmail && (
          <>
            <input
              ref={input}
              type="file"
              accept={accept}
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
        {showSavedReplies && (
          <button
            type="button"
            title={t('savedReplies')}
            aria-label={t('savedReplies')}
            aria-haspopup="listbox"
            aria-expanded={picker.open}
            aria-controls={picker.open ? picker.listId : undefined}
            data-testid="inbox-saved-replies-button"
            disabled={disabled}
            onClick={() => pickerRef.current?.toggle()}
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <SavedReplyIcon />
          </button>
        )}
        {!groupBlocked && !isEmail && (
          <>
            <button
              type="button"
              title={t('emoji')}
              aria-label={t('emoji')}
              aria-haspopup="dialog"
              aria-expanded={emojiOpen}
              data-testid="inbox-emoji-button"
              disabled={disabled}
              onClick={() => setEmojiOpen((v) => !v)}
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <SmileIcon />
            </button>
            {emojiOpen && !disabled && (
              <EmojiPicker
                onPick={addEmoji}
                onClose={() => {
                  setEmojiOpen(false);
                  area.current?.focus();
                }}
              />
            )}
          </>
        )}
        {richEmail && !groupBlocked ? (
          <RichEditor
            handleRef={editor}
            initialHtml={html}
            resetKey={`${conversationId}:${editorKey}`}
            onChange={changeHtml}
            onFiles={staged.add}
            onSubmit={() => void submit()}
            disabled={disabled}
            placeholder={disabled ? t('replyDisabledPlaceholder') : t('replyPlaceholder')}
            describedBy={hintId}
            testId="inbox-composer"
          />
        ) : (
          <textarea
            ref={area}
            onPaste={
              isEmail
                ? (e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length === 0) return;
                    e.preventDefault();
                    staged.add(files);
                  }
                : undefined
            }
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
            onChange={(e) => {
              change(e.target.value);
              syncMention(e.target);
              if (showSavedReplies) {
                pickerRef.current?.textChanged(e.target.value, e.target.selectionStart);
              }
            }}
            // The caret moved without typing (arrows, a click): a `/query` it left stops being a query.
            onSelect={(e) => {
              syncMention(e.currentTarget);
              if (showSavedReplies) {
                pickerRef.current?.textChanged(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart,
                );
              }
            }}
            onKeyDown={onKey}
            role={showSavedReplies && picker.open ? 'combobox' : undefined}
            aria-expanded={showSavedReplies && picker.open ? true : undefined}
            aria-controls={showSavedReplies && picker.open ? picker.listId : undefined}
            aria-activedescendant={showSavedReplies && picker.open ? picker.activeId : undefined}
            aria-autocomplete={showSavedReplies && picker.open ? 'list' : undefined}
            className={cn(
              'max-h-36 min-h-10 w-full flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
              isNote ? 'border-warning/50 bg-warning/5' : 'border-border',
            )}
          />
        )}
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
      {isEmail && !isNote && !groupBlocked && props.email?.channelId && (
        <SignaturePicker
          channelId={props.email.channelId}
          choice={signature}
          onChange={setSignature}
          disabled={disabled}
        />
      )}
      {isEmail && !isNote && !groupBlocked && (
        <EmailComposerFooter
          rich={rich}
          onToggle={toggleRich}
          uploading={staged.uploading}
          failed={staged.failed}
        />
      )}
      <p
        id={hintId}
        role={groupBlocked ? 'status' : undefined}
        data-testid={groupBlocked ? 'inbox-group-send-unavailable' : undefined}
        className="px-3 pb-2 text-[11px] text-muted-foreground"
      >
        {groupBlocked ? (
          (props.groupBlockedHint ?? t('groupSendUnavailable'))
        ) : richEmail ? (
          <EmailEditorHint />
        ) : (
          t('hint')
        )}
        {limited && !isNote && !groupBlocked && props.canAttach && (
          <>
            {' '}
            <AttachmentHints allowed={limited.allowed} />
          </>
        )}
      </p>
    </div>
  );
}
