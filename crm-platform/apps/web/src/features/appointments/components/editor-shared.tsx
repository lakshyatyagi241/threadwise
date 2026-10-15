'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Field, Input, Switch, cn } from '@crm/ui';
import type { BookingTypeDraft } from '../lib/booking-form';

/** What every step of the editor reads: the form, how to change it, and which problem lines to show. */
export interface EditorContextValue {
  draft: BookingTypeDraft;
  set: <K extends keyof BookingTypeDraft>(key: K, value: BookingTypeDraft[K]) => void;
  /** Changes several boxes in one go, from the latest form. */
  update: (fn: (d: BookingTypeDraft) => BookingTypeDraft) => void;
  /** The translated problem line to show under the box `key`, or undefined when there is none (yet). */
  err: (key: string) => string | undefined;
  /** A stable element id for the box `key` (so a failed step can focus it). */
  fid: (key: string) => string;
  /** True while the form is saving, or read-only. */
  disabled: boolean;
  /** The saved booking type's id; null while it is new (nothing to attach a consent line to yet). */
  typeId: string | null;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export const EditorProvider = EditorContext.Provider;

export function useEditor(): EditorContextValue {
  const v = useContext(EditorContext);
  if (!v) throw new Error('useEditor must be used inside the booking type editor');
  return v;
}

/** A titled, bordered card of the form (the rounded-xl card the other long forms use). */
export function SectionCard({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-background p-4 sm:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

type StringKeys = {
  [K in keyof BookingTypeDraft]: BookingTypeDraft[K] extends string ? K : never;
}[keyof BookingTypeDraft];

/** A one-line text box bound to a string of the form, with its label, hint and problem line. */
export function TextField({
  name,
  label,
  hint,
  placeholder,
  numeric,
  mono,
  maxLength,
  className,
  disabled,
  onValue,
}: {
  name: StringKeys;
  label: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  /** Digits only: shows the numeric keyboard and reads left to right. */
  numeric?: boolean;
  mono?: boolean;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  /** Replaces the plain "set this field" (the name box also keeps the link in step). */
  onValue?: (value: string) => void;
}) {
  const { draft, set, err, fid, disabled: all } = useEditor();
  const error = err(name);
  return (
    <Field label={label} htmlFor={fid(name)} hint={hint} error={error} className={className}>
      <Input
        id={fid(name)}
        value={draft[name]}
        invalid={!!error}
        disabled={all || disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={numeric ? 'numeric' : undefined}
        dir={numeric || mono ? 'ltr' : undefined}
        autoComplete="off"
        onChange={(e) => (onValue ? onValue(e.target.value) : set(name, e.target.value as never))}
        className={cn(numeric && 'tabular-nums', mono && 'font-mono')}
      />
    </Field>
  );
}

/** A switch with its name and what it does, in one bordered row. */
export function SwitchRow({
  checked,
  onChange,
  title,
  hint,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  hint: string;
  disabled?: boolean;
  id: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {title}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        label={title}
        disabled={disabled}
      />
    </div>
  );
}

/** A small bordered chip button (quick-add values, insertable placeholders). */
export const chipClass =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';

/** The square icon button of a row (remove, move up, move down). */
export const iconButtonClass =
  'flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40';
