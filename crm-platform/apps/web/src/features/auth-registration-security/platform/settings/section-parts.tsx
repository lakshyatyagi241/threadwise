'use client';

import type { ReactNode } from 'react';
import { Card, Switch } from '@crm/ui';

/** A labelled on/off row with a hint and an inline error. Shared by the settings forms. */
export function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  error?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          {label}
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

/** A card with a kicker, a title and an optional description above its controls. */
export function Section({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-4">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {kicker}
        </p>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </Card>
  );
}
