'use client';

import { useEffect, useState } from 'react';
import { stripSearchParams } from './url-params';

/** A short-lived confirmation ("You've been signed out") that removes itself and cleans its URL flag. */
export function TransientToast({
  message,
  clearParam,
  durationMs = 6000,
}: {
  message: string;
  /** Query parameter to drop from the address bar once shown, so a reload does not repeat it. */
  clearParam?: string;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (clearParam) stripSearchParams([clearParam]);
    const id = window.setTimeout(() => setOpen(false), durationMs);
    return () => window.clearTimeout(id);
  }, [clearParam, durationMs]);

  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-6 z-50 mx-auto w-fit max-w-sm rounded-full border border-border bg-foreground px-5 py-2.5 text-center text-sm text-background shadow-lg"
    >
      {message}
    </div>
  );
}
