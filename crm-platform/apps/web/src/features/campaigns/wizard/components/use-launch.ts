'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { afterLaunchPath } from '../../history/lib';
import { launchDraft } from '../api/wizard';
import { classifyLaunchError, type LaunchFailure } from '../lib/launch-errors';

export const statusPath = (id: string) => `/campaigns/wizard/broadcasts/${id}`;

/**
 * Opens the confirm dialog and launches. A retry of the same confirm reuses its Idempotency-Key (a double click or a flaky network
 * cannot launch twice); a new dialog gets a new key. Each failure kind goes back to the wizard to be shown and acted on.
 */
export function useLaunch({
  id,
  rowVersion,
  release,
  onFailure,
}: {
  id: string | null;
  rowVersion: () => number | null;
  /** Lets the unsaved-changes guard step aside before navigating away. */
  release: () => void;
  onFailure: (f: LaunchFailure) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const key = useRef<string>('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    key.current = crypto.randomUUID();
    setError(null);
    setOpen(true);
  };

  const confirm = async (fallbackMessage: string) => {
    const version = rowVersion();
    if (!id || version === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await launchDraft(id, version, key.current);
      release();
      void qc.invalidateQueries({ queryKey: ['camp'] });
      // Each kind lands on its own history page, with the new row marked: now, scheduled or recurring.
      router.push(afterLaunchPath(result.mode, result.id));
    } catch (e) {
      const f = classifyLaunchError(e);
      if (f.kind === 'other') {
        setError(
          f.requestId
            ? `${f.message || fallbackMessage} (${f.requestId})`
            : f.message || fallbackMessage,
        );
      } else {
        setOpen(false);
        onFailure(f);
      }
    } finally {
      setBusy(false);
    }
  };

  return { open, busy, error, show, confirm, close: () => !busy && setOpen(false) };
}
