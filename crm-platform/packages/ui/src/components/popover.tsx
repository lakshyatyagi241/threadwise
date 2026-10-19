'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../cn';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the panel. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A small panel anchored under its relatively positioned parent (the bulk-action pickers).
 * Closes on Escape and on a press outside it. Focus is not trapped: it is a menu-like panel, not a dialog.
 */
export function Popover({ open, onClose, label, children, className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPress = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open, onClose]);

  if (!open) return null;
  // z-40 clears the frozen table header cells (z-30) that a panel inside a sticky table would otherwise sit under.
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cn(
        'absolute end-0 top-full z-40 mt-1 w-72 space-y-3 rounded-md border border-border bg-background p-3 text-start shadow-lg',
        className,
      )}
    >
      {children}
    </div>
  );
}
