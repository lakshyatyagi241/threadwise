'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Sticks to the bottom edge (Apply, Clear). */
  footer?: ReactNode;
  className?: string;
  /** Accessible name of the close button in the header. */
  closeLabel: string;
}

/**
 * A panel that slides in from the end edge (the right in left-to-right languages), on top of the native <dialog>: the browser traps
 * focus inside it and gives it back on close, Escape closes it, a click on the dimmed page closes it. The body scrolls inside the
 * panel; the header and the footer stay in view.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  closeLabel,
}: DrawerProps) {
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
        'crm-drawer fixed inset-y-0 start-auto end-0 m-0 h-dvh max-h-none w-[min(32rem,100vw)] max-w-none overflow-hidden',
        'border-s border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40',
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{open ? children : null}</div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
