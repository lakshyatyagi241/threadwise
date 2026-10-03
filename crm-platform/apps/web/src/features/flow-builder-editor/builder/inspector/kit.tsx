'use client';

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@crm/ui';

/**
 * The inspector's form controls. WaDesk's inspector draws every field as label + control + hint with the same classes;
 * these helpers keep every node form identical to it (field order, label wording and hints come from the node's form).
 * Controls are uncontrolled-safe plain elements: a form re-renders on every keystroke and must keep focus.
 */

export const controlClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] text-foreground outline-none focus:border-brand focus:ring-4 focus:ring-brand/10';

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
        <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground/80">{label}</label>
      ) : null}
      {children}
      {hint ? (
        <div className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  ...rest
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <input
      type="text"
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-attr-input="true"
      className={cn(controlClass, mono && 'font-mono')}
      {...rest}
    />
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
}: {
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  dark?: boolean;
}) {
  return (
    <textarea
      rows={rows}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-attr-input="true"
      className={cn(
        controlClass,
        'min-h-[110px] resize-y leading-relaxed',
        mono && 'font-mono',
        dark && 'bg-[#1E2A33] text-[#7CF3C4]',
      )}
    />
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

/** The tinted explanation boxes WaDesk puts above or between fields. */
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
      className={cn('mb-4 rounded-lg border px-3 py-2 text-[11.5px] leading-snug', NOTICE[tone], className)}
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
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
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
  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** A bordered card used for repeated rows (sequence replies, cta actions, cards, columns...). */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 overflow-hidden rounded-lg border border-border bg-background', className)}>
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
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">{children}</div>
      )}
      <div className="mt-0.5 text-right text-[9.5px]" style={{ color: 'rgba(0,0,0,0.45)' }}>
        {time()} ✓✓
      </div>
    </div>
  );
}
