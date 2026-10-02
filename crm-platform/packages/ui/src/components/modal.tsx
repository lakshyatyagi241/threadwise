'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Width: `sm` 32rem (default), `md` 40rem, `lg` 48rem. */
  size?: 'sm' | 'md' | 'lg';
  /** Small label above the title (the "New contact" kicker). */
  eyebrow?: ReactNode;
  /** When set, a close button with this accessible name is shown in the header. */
  closeLabel?: string;
}

const SIZES = {
  sm: 'w-[min(32rem,calc(100vw-2rem))]',
  md: 'w-[min(40rem,calc(100vw-2rem))]',
  lg: 'w-[min(48rem,calc(100vw-2rem))]',
} as const;

/**
 * Dialog on top of the native <dialog>: focus is trapped and restored by the
 * browser, Escape closes it, and the backdrop click closes it. Tall content
 * scrolls inside the dialog (max 90vh) instead of the page behind it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  size = 'sm',
  eyebrow,
  closeLabel,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto max-h-[90vh] rounded-md border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50',
        SIZES[size],
        className,
      )}
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {eyebrow}
              </div>
            )}
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
          </div>
          {closeLabel && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
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
          )}
        </div>
        <div>{children}</div>
        {footer && <div className="flex justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}
