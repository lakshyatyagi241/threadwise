'use client';

import { useSearchParams } from 'next/navigation';
import { HideShellChrome } from '@/components/shell/shell-chrome';

/** A page opened with `?embed=1` (inside the connect-a-device sheet) draws without header, rail or bars (WD-ASHELL-029). */
export function EmbedFlag() {
  return useSearchParams().get('embed') === '1' ? <HideShellChrome /> : null;
}
