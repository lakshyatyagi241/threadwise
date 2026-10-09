'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, type ReactNode } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import { errorKind, requestIdOf } from '../lib/errors';

/**
 * The wizard's cards (credit, variables, summary, schedule, retries, count) take the look of the screen they sit in. On Campaigns,
 * Create the builder provides `builder`: the same cards, in the builder's rounder frame and smaller titles.
 */
export const CardStyle = createContext<'wizard' | 'builder'>('wizard');

/** A titled card: the building block of the steps. */
export function WizardCard({
  title,
  hint,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const builder = useContext(CardStyle) === 'builder';
  return (
    <section
      id={id}
      className={cn(
        'border border-border bg-background',
        builder ? 'rounded-2xl' : 'rounded-xl',
        className,
      )}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2
            id={id ? `${id}-title` : undefined}
            className={builder ? 'text-[14px] font-semibold' : 'text-base font-semibold'}
          >
            {title}
          </h2>
          {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A failed call: what it means, the request id for support, and a retry. */
export function ErrorBlock({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('campaigns.wizard.errors');
  const requestId = requestIdOf(error);
  return (
    <Alert tone="danger" className={className}>
      <span>{t(errorKind(error))}</span>
      {requestId && (
        <span className="mt-1 block text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </span>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** Pulsing lines while a region loads. */
export function Skeleton({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse space-y-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={cn('h-4 rounded bg-muted', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
  className?: string;
}) {
  const tones = {
    neutral: 'border-border bg-muted text-muted-foreground',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/30 bg-danger/10 text-danger',
    brand: 'border-brand/30 bg-brand/10 text-brand',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A checkbox-like or radio-like card: the native input is visually hidden but keeps keyboard and screen reader behaviour. */
export function ChoiceCard({
  type,
  name,
  checked,
  onChange,
  disabled,
  children,
  className,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn('relative block cursor-pointer', disabled && 'cursor-not-allowed opacity-60')}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className={cn(
          'block rounded-lg border border-border bg-background p-3 text-sm transition hover:bg-muted/60',
          'peer-checked:border-brand peer-checked:bg-brand/5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
          className,
        )}
      >
        {children}
      </span>
    </label>
  );
}
