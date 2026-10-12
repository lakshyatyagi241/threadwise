'use client';

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { htmlToText, isBlankHtml, safeHref, sanitizeHtml } from '../lib/rich-text';

export interface RichEditorHandle {
  focus: () => void;
}

type Command = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';
const BUTTONS: ReadonlyArray<{ id: string; command: Command; label: string; glyph: string }> = [
  { id: 'bold', command: 'bold', label: 'bold', glyph: 'B' },
  { id: 'italic', command: 'italic', label: 'italic', glyph: 'I' },
  { id: 'underline', command: 'underline', label: 'underline', glyph: 'U' },
  { id: 'ul', command: 'insertUnorderedList', label: 'bulletList', glyph: '•' },
  { id: 'ol', command: 'insertOrderedList', label: 'numberedList', glyph: '1.' },
];

/**
 * A small rich-text box (TW-MAIL-027): bold, italic, underline, lists, a quote and links, built on the browser's own editing. Nothing
 * the person pastes is kept as it came: every change is rebuilt through the allow-list ({@link sanitizeHtml}) before it leaves, so the
 * HTML this reports is always safe to send and to show. The value is read once (and again when `resetKey` changes), so typing is
 * never interrupted. Ctrl or Cmd+Enter sends; Enter is a new line.
 */
export function RichEditor({
  initialHtml,
  resetKey,
  onChange,
  onFiles,
  onSubmit,
  disabled,
  label,
  placeholder,
  describedBy,
  testId = 'email-rich-editor',
  handleRef,
  className,
}: {
  initialHtml: string;
  /** Changing it loads `initialHtml` again (after a send, a new conversation, a switch from plain text). */
  resetKey: string | number;
  onChange: (html: string) => void;
  /** Pictures and files pasted into the box become attachments. */
  onFiles?: (files: File[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  /** Name for assistive technology; defaults to "Email reply". */
  label?: string;
  placeholder: string;
  describedBy?: string;
  testId?: string;
  handleRef?: Ref<RichEditorHandle>;
  className?: string;
}) {
  const t = useTranslations('email.composer.editor');
  const box = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkBad, setLinkBad] = useState(false);

  useImperativeHandle(handleRef, () => ({ focus: () => box.current?.focus() }));

  // Load the starting HTML (already clean) on mount and whenever the reset key changes.
  useEffect(() => {
    if (box.current) box.current.innerHTML = sanitizeHtml(initialHtml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const report = () => {
    const el = box.current;
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    onChange(isBlankHtml(html) ? '' : html);
  };

  const run = (command: string, value?: string) => {
    box.current?.focus();
    document.execCommand(command, false, value);
    report();
  };

  const remember = () => {
    const sel = window.getSelection();
    saved.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  };

  const restore = () => {
    const sel = window.getSelection();
    if (sel && saved.current) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
  };

  const applyLink = () => {
    const raw = link.trim();
    const href = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!raw || !href) {
      setLinkBad(true);
      return;
    }
    box.current?.focus();
    restore();
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) document.execCommand('insertText', false, raw);
    document.execCommand('createLink', false, href);
    setLinkOpen(false);
    setLink('');
    setLinkBad(false);
    report();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0 && onFiles) {
      e.preventDefault();
      onFiles(files);
      return;
    }
    // Never let the browser insert foreign markup: take the HTML through the allow-list, or the plain text.
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    report();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const tool =
    'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
  // Buttons must not take the selection away from the text.
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <div
        role="toolbar"
        aria-label={t('toolbar')}
        data-testid="email-editor-toolbar"
        className="mb-1 flex flex-wrap items-center gap-0.5"
      >
        {BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={disabled}
            title={t(b.label)}
            aria-label={t(b.label)}
            data-testid={`email-editor-${b.id}`}
            onMouseDown={keep}
            onClick={() => run(b.command)}
            className={cn(tool, b.id === 'italic' && 'italic', b.id === 'underline' && 'underline')}
          >
            {b.glyph}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          title={t('quote')}
          aria-label={t('quote')}
          data-testid="email-editor-quote"
          onMouseDown={keep}
          onClick={() => run('formatBlock', 'blockquote')}
          className={tool}
        >
          “
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t('link')}
          aria-label={t('link')}
          aria-expanded={linkOpen}
          data-testid="email-editor-link"
          onMouseDown={keep}
          onClick={() => {
            remember();
            setLinkOpen((v) => !v);
          }}
          className={tool}
        >
          🔗
        </button>
        <button
          type="button"
          disabled={disabled}
          title={t('clear')}
          aria-label={t('clear')}
          data-testid="email-editor-clear"
          onMouseDown={keep}
          onClick={() => run('removeFormat')}
          className={tool}
        >
          Tx
        </button>
      </div>
      {linkOpen && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
          <input
            type="url"
            dir="ltr"
            autoFocus
            value={link}
            data-testid="email-editor-link-input"
            aria-label={t('linkAddress')}
            aria-invalid={linkBad}
            placeholder="https://"
            onChange={(e) => {
              setLink(e.target.value);
              setLinkBad(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') setLinkOpen(false);
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="button"
            data-testid="email-editor-link-apply"
            onClick={applyLink}
            className="h-7 rounded-md bg-primary px-2.5 font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('linkApply')}
          </button>
          {linkBad && (
            <span role="alert" className="text-danger">
              {t('linkInvalid')}
            </span>
          )}
        </div>
      )}
      <div
        ref={box}
        role="textbox"
        aria-multiline="true"
        aria-label={label ?? t('label')}
        aria-describedby={describedBy}
        aria-disabled={disabled}
        data-testid={testId}
        data-placeholder={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        dir="auto"
        onInput={report}
        onBlur={report}
        onPaste={onPaste}
        onKeyDown={onKey}
        className={cn(
          'max-h-60 min-h-20 w-full overflow-y-auto rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          '[&_blockquote]:ms-1 [&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground',
          '[&_ul]:ms-5 [&_ul]:list-disc [&_ol]:ms-5 [&_ol]:list-decimal [&_a]:text-primary [&_a]:underline',
          disabled && 'cursor-not-allowed bg-muted opacity-70',
        )}
      />
    </div>
  );
}

/** What the plain-text fallback box starts with when the person leaves rich text. */
export const plainFromHtml = (html: string): string => htmlToText(html);
