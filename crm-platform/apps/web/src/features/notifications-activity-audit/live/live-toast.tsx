'use client';

import Link from 'next/link';
import type { KeyboardEvent } from 'react';
import { cn } from '@crm/ui';

export interface LiveToastView {
  id: number;
  title: string;
  body: string | null;
  /** Where "Open" goes; null for the summary toast, which only informs. */
  href: string | null;
  /** The bell row the toast stands for, marked read when the person opens it. */
  rowId?: string;
}

interface ToastLabels {
  openLabel: string;
  dismissLabel: string;
}

interface ToastActions {
  onOpen: (toast: LiveToastView) => void;
  onDismiss: (id: number) => void;
}

/**
 * The toast region for live notifications. It sits at the top corner (the page's own toasts use the bottom corner), so the two never
 * overlap. It carries no `aria-live`: the same words are announced once by the hidden live region of the provider, and a second
 * announcement from here would read every notification twice.
 */
export function LiveToastHost({
  toasts,
  label,
  ...rest
}: {
  toasts: readonly LiveToastView[];
  label: string;
} & ToastLabels &
  ToastActions) {
  if (toasts.length === 0) return null;
  return (
    <section
      aria-label={label}
      data-testid="live-toasts"
      className="pointer-events-none fixed inset-x-4 top-16 z-[55] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end"
    >
      {toasts.map((toast) => (
        <LiveToastItem key={toast.id} toast={toast} {...rest} />
      ))}
    </section>
  );
}

export function LiveToastItem({
  toast,
  openLabel,
  dismissLabel,
  onOpen,
  onDismiss,
}: { toast: LiveToastView } & ToastLabels & ToastActions) {
  // Escape closes the toast the keyboard is on; it never moves focus by itself.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDismiss(toast.id);
    }
  };
  return (
    <div
      onKeyDown={onKeyDown}
      data-testid="live-toast"
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-border bg-background px-4 py-2.5 text-sm shadow-lg"
    >
      <div className="min-w-0 flex-1">
        <span dir="auto" className="block break-words font-medium text-foreground">
          {toast.title}
        </span>
        {toast.body && (
          <span dir="auto" className="mt-0.5 block break-words text-muted-foreground">
            {toast.body}
          </span>
        )}
        {toast.href && (
          <Link
            href={toast.href}
            onClick={() => onOpen(toast)}
            className={cn(
              'mt-1 inline-block rounded text-xs font-medium text-brand outline-none',
              'hover:underline focus-visible:ring-2 focus-visible:ring-primary',
            )}
          >
            {openLabel}
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={dismissLabel}
        className="-me-1 shrink-0 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
