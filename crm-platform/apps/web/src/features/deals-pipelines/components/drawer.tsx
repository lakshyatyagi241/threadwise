'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { CloseIcon } from './icons';

/**
 * A panel that slides in from the trailing edge (the right in English, the left in Arabic) on top of the page, built
 * on the native <dialog>: focus is trapped and restored by the browser, Escape and a click on the backdrop close it.
 */
export function Drawer({
  onClose,
  title,
  closeLabel,
  children,
  className,
}: {
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'fixed inset-y-0 m-0 ms-auto me-0 h-dvh max-h-none w-[min(34rem,100vw)] max-w-none flex-col border-0 border-s border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40 open:flex',
        className,
      )}
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute end-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <CloseIcon />
      </button>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </dialog>
  );
}
