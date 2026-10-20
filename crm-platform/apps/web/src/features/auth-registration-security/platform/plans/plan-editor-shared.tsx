'use client';

import type { ReactNode } from 'react';
import { Switch } from '@crm/ui';
import type { PlanDraft, PlanField, PlanProblems } from '../lib/plan-draft';

export const NS = 'auth-registration-security.platform.plans.editor';
export const FORM_ID = 'plan-editor-form';
export const fieldId = (f: PlanField) => `plan-${f.replace('.', '-')}`;

/** What every tab of the editor reads and writes: the one draft, its problems, and the setters. */
export interface EditorState {
  draft: PlanDraft;
  problems: PlanProblems;
  /** The message for one field's problem, already translated. */
  err: (field: PlanField) => string | undefined;
  set: <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => void;
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="space-y-0.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  error,
  badge,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  error?: string;
  /** A small tag beside the label (the product line of a plan feature). */
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {label}
          {badge && <span className="ms-2 align-middle">{badge}</span>}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        label={label}
        disabled={disabled}
      />
    </div>
  );
}

/** A search box plus the bulk buttons of a tab, wrapping on a phone. */
export function ToolbarRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
