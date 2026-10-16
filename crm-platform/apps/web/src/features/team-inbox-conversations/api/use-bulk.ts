'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@crm/ui';
import { BULK_MAX_CONVERSATIONS, type BulkConversationAction } from '@crm/contracts';
import {
  EMPTY_SELECTION,
  allInViewSelected,
  failedIds,
  pruneSelection,
  selectAllInView,
  selectRange,
  summarize,
  toggleId,
  type Selection,
} from '../lib/selection';
import { useErrorText } from '../components/parts';
import { inboxApi } from './service';

export interface BulkSelection {
  selecting: boolean;
  selection: Selection;
  busy: boolean;
  allInView: boolean;
  toggleSelecting: () => void;
  select: (id: string, shift: boolean) => void;
  /** A tick on a row's hover box: starts the selection if none is on, toggles the row (shift: the run), and ends it when the last tick is taken off. */
  pick: (id: string, shift: boolean) => void;
  selectAll: () => void;
  clear: () => void;
  run: (action: BulkConversationAction) => void;
}

/**
 * The state behind the list's "Select" mode: which conversations are picked (click, shift-click for a run, all in view), and the call
 * that applies one action to them. A selection belongs to the view it was made in: changing the filters clears it, and a row that
 * leaves the list (resolved out of the open view, for example) is dropped from it. After a call the ones that failed stay picked.
 */
export function useBulkSelection(
  rows: ReadonlyArray<{ id: string }>,
  viewKey: string,
  onApplied: () => void,
): BulkSelection {
  const t = useTranslations('team-inbox-conversations.bulk');
  const { toast } = useToast();
  const errorText = useErrorText();
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<string | null>(null);
  // Select mode started with the Select button stays on until Done; one started by a tick on a row ends with its last tick.
  const manual = useRef(false);
  const viewRef = useRef(viewKey);

  useEffect(() => {
    if (viewRef.current !== viewKey) {
      viewRef.current = viewKey;
      anchor.current = null;
      setSelection(EMPTY_SELECTION);
      return;
    }
    setSelection((s) => pruneSelection(s, rows));
  }, [rows, viewKey]);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelection(EMPTY_SELECTION);
  }, []);

  const select = useCallback(
    (id: string, shift: boolean) => {
      setSelection((s) => (shift ? selectRange(s, rows, anchor.current, id) : toggleId(s, id)));
      anchor.current = id;
    },
    [rows],
  );

  const pick = useCallback(
    (id: string, shift: boolean) => {
      const next = shift
        ? selectRange(selection, rows, anchor.current, id)
        : toggleId(selection, id);
      anchor.current = id;
      setSelection(next);
      setSelecting(next.size > 0 || manual.current);
    },
    [rows, selection],
  );

  const run = useCallback(
    (action: BulkConversationAction) => {
      if (busy || selection.size === 0) return;
      const ids = [...selection];
      setBusy(true);
      void (async () => {
        try {
          // The server takes at most BULK_MAX_CONVERSATIONS at once; a longer selection goes in runs, one after the other.
          const results = [];
          let done = 0;
          let unchanged = 0;
          let failed = 0;
          for (let i = 0; i < ids.length; i += BULK_MAX_CONVERSATIONS) {
            const res = await inboxApi.bulk({
              ids: ids.slice(i, i + BULK_MAX_CONVERSATIONS),
              action,
            });
            results.push(...res.results);
            done += res.done;
            unchanged += res.unchanged;
            failed += res.failed;
          }
          const outcome = summarize({ requested: ids.length, done, unchanged, failed });
          toast(
            t(`result.${outcome}`, { done, unchanged, failed, count: ids.length }),
            outcome === 'allFailed' ? 'danger' : outcome === 'partial' ? 'info' : 'success',
          );
          setSelection(failed > 0 ? failedIds(results) : EMPTY_SELECTION);
          onApplied();
        } catch (e) {
          toast(errorText(e), 'danger');
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, selection, toast, t, errorText, onApplied],
  );

  return {
    selecting,
    selection,
    busy,
    allInView: allInViewSelected(rows, selection),
    toggleSelecting: () => {
      manual.current = !selecting;
      setSelecting(!selecting);
      clear();
    },
    select,
    pick,
    selectAll: () => setSelection(selectAllInView(rows)),
    clear,
    run,
  };
}
