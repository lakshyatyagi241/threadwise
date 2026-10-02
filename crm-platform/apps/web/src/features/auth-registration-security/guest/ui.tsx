'use client';

import {
  Alert as BaseAlert,
  Button as BaseButton,
  Checkbox as BaseCheckbox,
  Input as BaseInput,
  PasswordInput as BasePasswordInput,
  Select as BaseSelect,
  cn,
  type ButtonProps,
  type CheckboxProps,
  type InputProps,
  type PasswordInputProps,
  type SelectProps,
} from '@crm/ui';
import type { ComponentProps } from 'react';

/**
 * The shared primitives, dressed for the guest pages: pill buttons, 8 px fields with a soft green focus ring,
 * small copy. They wrap `@crm/ui` (so behaviour and accessibility stay in one place) and only add classes;
 * the palette itself comes from the `.auth-scope` tokens in auth.css.
 */

export { Spinner, cn } from '@crm/ui';

/** The small right arrow on the main buttons (mirrored in right-to-left languages). */
export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
      className={cn('size-3.5 rtl:-scale-x-100', className)}
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/** A link that looks like the main button (a way forward after a dead end). */
export const PRIMARY_LINK =
  'inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-[13px] font-semibold text-primary-foreground hover:bg-(--auth-teal)';

/** Class names for text links on the guest pages. */
export const LINK = 'font-semibold text-(--auth-link) hover:underline underline-offset-2';

/** Shared field look: 13 px text, 10 px/12 px padding, 8 px corners, green border and halo on focus. */
export const FIELD =
  'h-auto rounded-lg px-3 py-2.5 text-[13px] focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10';

export function Input({ className, ...rest }: InputProps) {
  return <BaseInput className={cn(FIELD, className)} {...rest} />;
}

export function PasswordInput({ className, ...rest }: PasswordInputProps) {
  return <BasePasswordInput className={cn(FIELD, 'font-mono', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectProps) {
  return <BaseSelect className={cn(FIELD, className)} {...rest} />;
}

export function Checkbox({ className, ...rest }: CheckboxProps) {
  return (
    <BaseCheckbox
      className={cn('items-center gap-2 text-[12.5px] text-(--auth-ink-700)', className)}
      {...rest}
    />
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-primary text-primary-foreground hover:bg-(--auth-teal) hover:opacity-100 dark:hover:bg-(--auth-teal)',
  secondary:
    'border border-border bg-background text-(--auth-ink-700) hover:bg-muted hover:text-foreground',
  ghost: 'text-(--auth-ink-700) hover:bg-muted',
  danger: 'bg-danger text-danger-foreground hover:opacity-90',
} as const;

/** Pill button. `size="md"` is the full-width call to action, `size="sm"` the compact secondary one. */
export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...rest
}: Omit<ButtonProps, 'size'> & { size?: 'sm' | 'md' }) {
  return (
    <BaseButton
      variant={variant}
      className={cn(
        'h-auto rounded-full font-semibold',
        size === 'md' ? 'px-4 py-3 text-[13px]' : 'px-3.5 py-1.5 text-[12px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONES: Record<AlertTone, string> = {
  danger:
    'border-(--auth-coral)/40 bg-(--auth-coral)/10 text-(--auth-coral-ink) text-[12px] dark:bg-(--auth-coral)/15',
  success: 'border-(--auth-green)/40 bg-(--auth-mint) text-(--auth-link) text-[12.5px]',
  warning: 'border-(--auth-amber)/45 bg-(--auth-amber)/10 text-(--auth-ink-800) text-[12.5px]',
  info: 'border-border bg-muted text-(--auth-ink-700) text-[12.5px]',
};

/** Notice box: coral for errors, mint for confirmations, amber for cautions. */
export function Alert({
  tone = 'info',
  className,
  ...rest
}: ComponentProps<typeof BaseAlert> & { tone?: AlertTone }) {
  return (
    <BaseAlert tone={tone} className={cn('rounded-lg', ALERT_TONES[tone], className)} {...rest} />
  );
}
