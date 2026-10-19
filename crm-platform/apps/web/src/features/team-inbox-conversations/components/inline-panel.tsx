'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@crm/ui';

/**
 * The panel of a dropdown inside the Filters window. It sits in the flow under its field (the window then grows or scrolls) instead
 * of floating over it: the window clips anything that floats outside it. Closes on a press outside it, and scrolls into view when it opens.
 */
export function InlinePanel(p: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { open, onClose } = p;
  useEffect(() => {
    if (!open) return;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
    const onPress = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="group"
      aria-label={p.label}
      className={cn(
        'mt-1 rounded-md border border-border bg-background text-start shadow-sm',
        p.className,
      )}
    >
      {p.children}
    </div>
  );
}
