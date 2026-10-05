'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@crm/ui';
import { usePickerFeed } from '@/features/contacts-attributes-tags';
import {
  attrEntries,
  filterAttrs,
  findSlashQuery,
  insertAttrToken,
  stepActive,
  type AttrEntry,
} from './attr-picker';

/**
 * The inspector's form controls. Reference's inspector draws every field as label + control + hint with the same classes;
 * these helpers keep every node form identical to it (field order, label wording and hints come from the node's form).
 * Controls are uncontrolled-safe plain elements: a form re-renders on every keystroke and must keep focus.
 */

export const controlClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

/** Label, control and an optional hint (hints may carry a link, so they are nodes, not strings). */
export function Field({
  label,
  children,
  hint,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4', className)}>
      {label ? (
        <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground/80">
          {label}
        </label>
      ) : null}
      {children}
      {hint ? (
        <div className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * "Type / to insert an attribute" for a text field (Reference's attribute-picker): "/" at the start of a word opens a list of the
 * workspace's merge tokens under the field; type to filter, arrows move, Enter or Tab insert `{{key}}`, Escape closes.
 */
type AttrEl = HTMLInputElement | HTMLTextAreaElement;

interface PopoverPos {
  left: number;
  top: number;
  width: number;
}

const POPOVER_W = 300;
const POPOVER_H = 280;

function useAttrPicker<T extends AttrEl>(
  value: string,
  onChange: (v: string) => void,
  enabled: boolean,
) {
  const ref = useRef<T>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const feed = usePickerFeed();
  const entries = useMemo(() => attrEntries(feed.data), [feed.data]);

  const slash = enabled ? findSlashQuery(value, Math.min(caret, value.length)) : null;
  const open = slash !== null && dismissedAt !== slash.start;
  const matches = useMemo(() => (slash ? filterAttrs(entries, slash.query) : []), [entries, slash]);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  // Anchor under the field, flipped above when there is no room (Reference anchors at the caret; a field is narrower than 300px).
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const width = Math.min(POPOVER_W, window.innerWidth - 16);
    let top = r.bottom + 4;
    if (top + POPOVER_H > window.innerHeight - 8) top = Math.max(8, r.top - POPOVER_H - 4);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top, width });
  }, [open, value]);

  // An outer scroll or resize detaches the list from the field, so it closes (scrolling inside the list does not).
  useEffect(() => {
    if (!open || !slash) return;
    const start = slash.start;
    const close = (e: Event) => {
      if (
        e.target instanceof Node &&
        document.getElementById('flb-attr-popover')?.contains(e.target)
      )
        return;
      setDismissedAt(start);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, slash]);

  const pick = (entry: AttrEntry) => {
    if (!slash || !ref.current) return;
    const next = insertAttrToken(value, slash.start, ref.current.selectionEnd ?? caret, entry.key);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    const el = ref.current;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const handlers = {
    ref,
    onChange: (e: { target: T }) => {
      onChange(e.target.value);
      setCaret(e.target.selectionStart ?? e.target.value.length);
      setActive(0);
      setDismissedAt(null);
    },
    onSelect: (e: { currentTarget: T }) => setCaret(e.currentTarget.selectionStart ?? 0),
    onKeyDown: (e: KeyboardEvent<T>) => {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissedAt(slash!.start);
      } else if (matches.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setActive(stepActive(current, matches.length, e.key === 'ArrowDown' ? 1 : -1));
      } else if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        pick(matches[current]!);
      }
    },
    onBlur: () => setDismissedAt(slash?.start ?? null),
  };

  const popover =
    open && pos && typeof document !== 'undefined'
      ? createPortal(
          <div
            id="flb-attr-popover"
            role="listbox"
            className="fixed z-[80] overflow-hidden rounded-xl border border-border bg-background shadow-[0_18px_40px_-15px_rgba(11,31,28,0.45)]"
            style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: POPOVER_H }}
          >
            <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M3 8h10" />
              </svg>
              Insert attribute
              <span className="ml-auto text-foreground/80">/{slash!.query}</span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 232 }}>
              {matches.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  No attributes match.{' '}
                  <a href="/attributes" className="font-semibold text-brand hover:underline">
                    Create one
                  </a>
                  .
                </div>
              ) : (
                matches.map((a, i) => (
                  <button
                    key={`${a.kind}-${a.key}`}
                    type="button"
                    role="option"
                    aria-selected={i === current}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(a);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted',
                      i === current && 'bg-brand/10',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold',
                        a.kind === 'system'
                          ? 'bg-brand/10 text-brand'
                          : 'bg-[#F3E9FF] text-[#5B3D8A]',
                      )}
                    >
                      {a.kind === 'system' ? 'S' : 'C'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {a.name || a.key}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                        {a.key}
                        {a.description ? ` / ${a.description}` : ''}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return { handlers, popover };
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  noAttr,
  ...rest
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  /** Turns the "/" attribute picker off (a password is never a message). */
  noAttr?: boolean;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  const text = value === null || value === undefined ? '' : String(value);
  const picker = useAttrPicker<HTMLInputElement>(
    text,
    onChange,
    !noAttr && rest.type !== 'password',
  );
  const { handlers } = picker;
  return (
    <>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        {...(noAttr || rest.type === 'password' ? {} : { 'data-attr-input': 'true' })}
        className={cn(controlClass, mono && 'font-mono')}
        {...rest}
        /* eslint-disable react-hooks/refs -- the hook hands back a ref object and event handlers; nothing reads ref.current while rendering */
        ref={handlers.ref}
        onChange={handlers.onChange}
        onSelect={handlers.onSelect}
        onKeyDown={handlers.onKeyDown}
        onBlur={handlers.onBlur}
        /* eslint-enable react-hooks/refs */
      />
      {picker.popover}
    </>
  );
}

/** A password field with Reference's show/hide eye (its app shell adds one to every password input). */
export function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        type={shown ? 'text' : 'password'}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className={cn(controlClass, 'pe-10')}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute inset-y-0 end-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
          {shown ? <path d="M2.5 13.5l11-11" /> : null}
        </svg>
      </button>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  value: unknown;
  onChange: (v: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value === null || value === undefined || Number.isNaN(value) ? '' : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      placeholder={placeholder}
      min={min}
      max={max}
      className={controlClass}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  mono,
  dark,
  noAttr,
  compact,
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  dark?: boolean;
  noAttr?: boolean;
  /** Drops the 110px minimum height (the prompt box on a canvas card). */
  compact?: boolean;
}) {
  const text = value === null || value === undefined ? '' : String(value);
  const picker = useAttrPicker<HTMLTextAreaElement>(text, onChange, !noAttr);
  const { handlers } = picker;
  return (
    <>
      <textarea
        rows={rows}
        value={text}
        placeholder={placeholder}
        {...(noAttr ? {} : { 'data-attr-input': 'true' })}
        className={cn(
          controlClass,
          compact ? 'min-h-[56px] resize-none' : 'min-h-[110px] resize-y',
          'leading-relaxed',
          mono && 'font-mono',
          dark && 'bg-[#1E2A33] text-[#7CF3C4]',
        )}
        /* eslint-disable react-hooks/refs -- the hook hands back a ref object and event handlers; nothing reads ref.current while rendering */
        ref={handlers.ref}
        onChange={handlers.onChange}
        onSelect={handlers.onSelect}
        onKeyDown={handlers.onKeyDown}
        onBlur={handlers.onBlur}
        /* eslint-enable react-hooks/refs */
      />
      {picker.popover}
    </>
  );
}

export interface Opt {
  v: string;
  l: string;
}

export function SelectInput({
  value,
  onChange,
  options,
}: {
  value: unknown;
  onChange: (v: string) => void;
  options: Opt[];
}) {
  return (
    <select
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      className={controlClass}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border text-brand focus:ring-brand/30"
      />
      <span>{children}</span>
    </label>
  );
}

type NoticeTone = 'neutral' | 'info' | 'warn' | 'danger' | 'ig';
const NOTICE: Record<NoticeTone, string> = {
  neutral: 'bg-muted border-border text-foreground/80',
  info: 'bg-[#E8F0FE] border-[#C6DAFC] text-[#1A4B8F]',
  warn: 'bg-amber-50 border-amber-200 text-amber-800',
  danger: 'bg-red-50 border-red-200 text-red-700',
  ig: 'bg-[#FCE7F3] border-[#F6BBD9] text-[#9D174D]',
};

/** The tinted explanation boxes Reference puts above or between fields. */
export function Notice({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-4 rounded-lg border px-3 py-2 text-[11.5px] leading-snug',
        NOTICE[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] font-medium text-foreground/80 hover:border-brand/40 hover:bg-brand/5"
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M8 3v10M3 8h10" strokeLinecap="round" />
      </svg>
      {children}
    </button>
  );
}

export function IconButton({
  onClick,
  title,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'grid h-6 w-6 place-items-center rounded hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30',
        danger && 'text-[#E87A5D] hover:bg-[#E87A5D]/15',
      )}
    >
      {children}
    </button>
  );
}

export const XIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="h-3 w-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** A bordered card used for repeated rows (sequence replies, cta actions, cards, columns...). */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-3 overflow-hidden rounded-lg border border-border bg-background',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Escapes text for the WhatsApp-style bubble preview and applies WhatsApp's *bold* _italic_ ~strike~ ```code``` marks. */
export function renderWaText(s: unknown): string {
  const esc = String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
  return esc
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/** The dark "Preview · WhatsApp" frame the inspector shows above message-like forms. */
export function WaPreview({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="mb-4 rounded-xl p-3" style={{ background: '#0E2A26' }}>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C9F0E1]/70">
        {label ?? 'Preview · WhatsApp'}
      </div>
      <div
        className="rounded-md p-2"
        style={{
          background: 'rgba(13,42,38,0.55)',
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '6px 6px',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const time = (): string => {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
};

/** A sent-message bubble (green, right aligned) with the clock and double tick. */
export function WaBubble({ html, children }: { html?: string; children?: ReactNode }) {
  return (
    <div
      className="relative mb-1 ml-auto max-w-[88%] rounded-lg px-2.5 py-1.5 shadow-sm"
      style={{ background: '#D9FDD3', color: '#111B21' }}
    >
      {html !== undefined ? (
        <div
          className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
          {children}
        </div>
      )}
      <div className="mt-0.5 text-right text-[9.5px]" style={{ color: 'rgba(0,0,0,0.45)' }}>
        {time()} ✓✓
      </div>
    </div>
  );
}
