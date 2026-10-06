'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WizardDraftResponse } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { wizardDraftResponseSchema } from '@crm/contracts';
import { BASE, KEYS, createDraft, updateDraft } from '../api/wizard';
import { Autosaver, type SaveStatus } from '../lib/autosave';
import {
  draftPatch,
  initialState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from '../lib/state';

export const wizardPath = (id: string) => `/campaigns/wizard/${id}`;

/**
 * The wizard's state and its saving. `dispatch` applies an action to the draft and hands what changed to the saver, which creates the
 * draft on the first change and saves later ones after a pause. `flush` saves now (before Next, Back, a test, the launch).
 */
export function useWizard(initial: WizardDraftResponse | null) {
  const qc = useQueryClient();
  const [state, setState] = useState<WizardState>(() => initialState(initial?.draft));
  const stateRef = useRef(state);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [meta, setMeta] = useState<{ id: string | null; rowVersion: number | null }>({
    id: initial?.id ?? null,
    rowVersion: initial?.rowVersion ?? null,
  });
  /** Bumped when the draft is replaced from the server, so editors holding local copies start over. */
  const [epoch, setEpoch] = useState(0);
  const saver = useRef<Autosaver | null>(null);

  if (saver.current === null) {
    saver.current = new Autosaver(
      {
        create: createDraft,
        update: updateDraft,
        onStatus: (s) => setStatus(s),
        onSaved: (saved) => {
          setMeta({ id: saved.id, rowVersion: saved.rowVersion });
          // The first save gives the draft its address: later reloads and "Back" land on it, without remounting the wizard.
          if (typeof window !== 'undefined' && !window.location.pathname.endsWith(saved.id)) {
            window.history.replaceState(window.history.state, '', wizardPath(saved.id));
          }
        },
      },
      initial ? { id: initial.id, rowVersion: initial.rowVersion } : null,
    );
  }

  useEffect(() => {
    const s = saver.current;
    return () => s?.dispose();
  }, []);

  const dispatch = useCallback((action: WizardAction) => {
    const prev = stateRef.current;
    const next = wizardReducer(prev, action);
    if (next === prev) return;
    stateRef.current = next;
    setState(next);
    if (action.type !== 'hydrate') saver.current?.change(draftPatch(prev.draft, next.draft));
  }, []);

  const flush = useCallback(() => saver.current!.flush(), []);

  /** After a 409: take the server's version (what the other session saved) and continue from it. */
  const reload = useCallback(async () => {
    const id = saver.current?.id;
    if (!id) return;
    const fresh = await apiFetch(`${BASE}/drafts/${id}`, { schema: wizardDraftResponseSchema });
    saver.current!.reset({ id: fresh.id, rowVersion: fresh.rowVersion });
    setMeta({ id: fresh.id, rowVersion: fresh.rowVersion });
    qc.setQueryData(KEYS.draft(fresh.id), fresh);
    const next = initialState(fresh.draft);
    stateRef.current = next;
    setState(next);
    setEpoch((n) => n + 1);
  }, [qc]);

  return {
    state,
    dispatch,
    flush,
    reload,
    status,
    epoch,
    id: meta.id,
    rowVersion: () => saver.current?.rowVersion ?? meta.rowVersion,
    unsaved:
      status === 'pending' || status === 'saving' || status === 'error' || status === 'conflict',
  };
}
