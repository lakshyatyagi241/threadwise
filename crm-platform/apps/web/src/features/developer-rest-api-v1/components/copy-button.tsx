'use client';

import { useEffect, useRef, useState } from 'react';
import { cn, useToast } from '@crm/ui';
import { COPIED_MS } from '../lib/keys-model';
import { CheckIcon, CopyIcon } from './icons';

/** Writes to the clipboard; false when the browser refuses (insecure origin, permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A copy button that swaps its icon to a check for a moment and says "Copied" to screen readers. When the browser refuses, a toast
 * tells the person to select the text by hand: never a silent failure. `children` is the visible label (the banner's "Copy");
 * without it the button is icon-only and `label` names it.
 */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failedLabel,
  className,
  children,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { toast } = useToast();
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    if (!(await copyText(text))) {
      toast(failedLabel, 'danger');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void onClick()}
        title={label}
        aria-label={children ? undefined : label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {children ? (copied ? copiedLabel : children) : null}
      </button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}
