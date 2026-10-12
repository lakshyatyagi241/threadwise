'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { deleteStagedAttachment, uploadEmailAttachment } from '../api/composer';
import {
  admit,
  hasFailed,
  isUploading,
  readyIds,
  stagedFrom,
  stagedReducer,
  type Refusal,
  type StagedFile,
} from './staged-attachments';

const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : 'NETWORK');

/**
 * The files of the reply being written: uploads each one at once, reports progress, takes one back (and deletes it from the server),
 * retries a failed one and gives the ids to send. State belongs to one conversation: another conversation starts without any.
 */
export function useStagedAttachments(conversationId: string) {
  const [files, dispatch] = useReducer(stagedReducer, [] as StagedFile[]);
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  const aborts = useRef(new Map<string, AbortController>());
  const latest = useRef(files);
  useEffect(() => {
    latest.current = files;
  });
  const conversation = useRef(conversationId);

  const upload = useCallback((key: string, file: File, conv: string) => {
    const ctl = new AbortController();
    aborts.current.set(key, ctl);
    uploadEmailAttachment(
      file,
      conv,
      (progress) => dispatch({ type: 'progress', key, progress }),
      ctl.signal,
    )
      .then((done) => dispatch({ type: 'uploaded', key, id: done.id }))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        dispatch({ type: 'failed', key, error: codeOf(e) });
      })
      .finally(() => aborts.current.delete(key));
  }, []);

  const add = useCallback(
    (chosen: readonly File[]) => {
      const { accepted, refused } = admit(latest.current, chosen);
      setRefusals(refused);
      if (accepted.length === 0) return;
      const items = accepted.map((f) => stagedFrom(f, crypto.randomUUID()));
      dispatch({ type: 'add', items });
      for (const item of items) upload(item.key, item.file!, conversation.current);
    },
    [upload],
  );

  const remove = useCallback((key: string) => {
    const f = latest.current.find((x) => x.key === key);
    aborts.current.get(key)?.abort();
    dispatch({ type: 'remove', key });
    // Best effort: a staged file that is not deleted simply expires.
    if (f?.id) void deleteStagedAttachment(f.id).catch(() => undefined);
  }, []);

  const retry = useCallback(
    (key: string) => {
      const f = latest.current.find((x) => x.key === key);
      if (!f?.file) return;
      dispatch({ type: 'retry', key });
      upload(key, f.file, conversation.current);
    },
    [upload],
  );

  /** After a send: the files left with the reply (the server marks them used), nothing to delete. */
  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
    setRefusals([]);
  }, []);

  // Another conversation: its own (empty) set; what was staged for the previous one is taken back.
  useEffect(() => {
    if (conversation.current === conversationId) return;
    for (const f of latest.current) {
      aborts.current.get(f.key)?.abort();
      if (f.id) void deleteStagedAttachment(f.id).catch(() => undefined);
    }
    conversation.current = conversationId;
    dispatch({ type: 'clear' });
    setRefusals([]);
  }, [conversationId]);

  useEffect(() => {
    const map = aborts.current;
    return () => {
      for (const c of map.values()) c.abort();
    };
  }, []);

  return {
    files,
    refusals,
    add,
    remove,
    retry,
    clear,
    dismissRefusals: () => setRefusals([]),
    ids: readyIds(files),
    uploading: isUploading(files),
    failed: hasFailed(files),
  };
}
