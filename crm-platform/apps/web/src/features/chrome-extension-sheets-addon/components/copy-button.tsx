'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, useToast } from '@crm/ui';
import { COPIED_MS } from '../lib/model';
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

/** A copy button that says "Copied" to screen readers too. When the browser refuses, a toast says to copy by hand: never silent. */
export function CopyButton({
  text,
  label,
  copiedLabel,
  failedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
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
      <Button variant="secondary" size="sm" onClick={() => void onClick()}>
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? copiedLabel : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}
