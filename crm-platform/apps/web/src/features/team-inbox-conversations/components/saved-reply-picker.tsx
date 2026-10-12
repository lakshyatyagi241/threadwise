'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import type { SavedReply, SavedReplyIssue } from '@crm/contracts';
import { Badge, Spinner, cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { refreshSavedReplies, savedRepliesApi, usePickerReplies } from '../api/saved-replies';
import {
  moveActive,
  optionId,
  rankReplies,
  slashTrigger,
  type SlashTrigger,
} from '../lib/saved-replies';
import { useErrorText } from './parts';

/** What the composer asks the picker to do, and what the picker tells the composer. */
export interface SavedReplyPickerHandle {
  /** The text or the caret changed: opens the list for a `/query`, updates it, or closes it when the caret left the word. */
  textChanged: (text: string, caret: number) => void;
  /** A key pressed in the composer's box. True when the picker used it, so the composer must not (no send, no new line). */
  keyDown: (e: KeyboardEvent<HTMLElement>) => boolean;
  /** The "Saved replies" button: opens the list with its own search box, or closes it. */
  toggle: () => void;
  close: () => void;
}

export interface PickerState {
  open: boolean;
  listId: string;
  /** The id of the highlighted option, for `aria-activedescendant` on the box the keys are typed in. */
  activeId: string | undefined;
}

export interface SavedReplyPickerProps {
  conversationId: string;
  channelKind?: string;
  handleRef: Ref<SavedReplyPickerHandle>;
  /**
   * Puts the filled-in reply into the composer: in place of the typed `/query`, or at the caret/selection when opened from the
   * button. Returns false when it would not fit the channel's length limit (the composer's text is then left alone).
   */
  onInsert: (text: string, range: { start: number; end: number } | null) => boolean;
  /** Variables the server could not fill: left as written in the text; the composer says so. */
  onIssues: (issues: SavedReplyIssue[]) => void;
  /** The list closed from the keyboard or after an insert: give the focus back to the box. */
  onClosed: () => void;
  onState: (state: PickerState) => void;
}

/**
 * The saved-reply list under the composer. Typing `/` at the start of a word opens it filtered by what follows; the button next to
 * "Attach" opens it with a search box. Arrow keys move, Enter or Tab inserts, Escape closes. Choosing a reply asks the server to fill in
 * its variables for THIS conversation and puts the result in the box; it never sends anything. Rendered only for agents who may reply.
 */
export function SavedReplyPicker(props: SavedReplyPickerProps) {
  const t = useTranslations('team-inbox-conversations.savedReplies.picker');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const canManage = useCan('inbox.savedreply.manage');
  const base = useId();
  const listId = `${base}-list`;
  const [mode, setMode] = useState<'slash' | 'button' | null>(null);
  const [trigger, setTrigger] = useState<SlashTrigger | null>(null);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState({ key: '', index: 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // A `/query` dismissed with Escape stays closed while the caret is still in that word.
  const dismissed = useRef<number | null>(null);
  const open = mode !== null;
  const typed = mode === 'slash' ? (trigger?.query ?? '') : search;
  const query = useDeferredValue(typed.trim().replace(/^\/+/, ''));

  const found = usePickerReplies(props.channelKind, query, open);
  const rows = useMemo(() => rankReplies(found.data?.data ?? [], typed), [found.data, typed]);
  const total = found.data?.counts.all ?? 0;

  // The highlight starts on the best match again whenever the list changes under it.
  // The highlight is per list: when the query, the mode or the rows change it is back on the first row, without an effect.
  const listKey = `${mode}|${typed}|${rows.map((r) => r.id).join(',')}`;
  const active = cursor.key === listKey ? cursor.index : 0;
  const setActive = (index: number) => setCursor({ key: listKey, index });

  const activeRow = rows[Math.min(active, rows.length - 1)];
  const activeId = open && activeRow ? optionId(listId, activeRow.id) : undefined;
  const { onState } = props;
  useEffect(() => onState({ open, listId, activeId }), [open, listId, activeId, onState]);

  function close(giveFocusBack: boolean) {
    if (mode === 'slash' && trigger) dismissed.current = trigger.start;
    setMode(null);
    setTrigger(null);
    setSearch('');
    setProblem(null);
    if (giveFocusBack) props.onClosed();
  }

  async function pick(reply: SavedReply) {
    if (busyId) return;
    setBusyId(reply.id);
    setProblem(null);
    try {
      const filled = await savedRepliesApi.use(reply.id, props.conversationId);
      const range = mode === 'slash' && trigger ? { start: trigger.start, end: trigger.end } : null;
      if (!props.onInsert(filled.text, range)) {
        setProblem(t('tooLong'));
        return;
      }
      props.onIssues(filled.issues);
      void refreshSavedReplies(qc);
      close(true);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusyId(null);
    }
  }

  /** Keys typed in the composer's box or in the search box. True when the list used the key. */
  function keyDown(e: KeyboardEvent<HTMLElement>): boolean {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(moveActive(active, rows.length, e.key as 'ArrowDown' | 'ArrowUp'));
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return true;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      // Enter on a `/query` with no match must not send "/query" to the customer: the open list uses it up.
      if (e.key === 'Enter' || activeRow) e.preventDefault();
      if (activeRow) void pick(activeRow);
      return e.key === 'Enter' || activeRow !== undefined;
    }
    return false;
  }

  useImperativeHandle(props.handleRef, () => ({
    textChanged: (text, caret) => {
      const next = slashTrigger(text, caret);
      if (!next) dismissed.current = null;
      if (next && dismissed.current === next.start) return;
      if (next) {
        setTrigger(next);
        setMode('slash');
        setProblem(null);
      } else if (mode === 'slash') {
        setTrigger(null);
        setMode(null);
      }
    },
    keyDown,
    toggle: () => {
      if (open) {
        close(true);
        return;
      }
      setSearch('');
      setProblem(null);
      setMode('button');
      requestAnimationFrame(() => searchBox.current?.focus());
    },
    close: () => close(false),
  }));

  if (!open) return null;

  const searching = query !== '';
  return (
    <div
      data-testid="saved-reply-picker"
      className="absolute inset-x-3 bottom-full z-20 mb-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-semibold text-muted-foreground">{t('title')}</p>
        <button
          type="button"
          aria-label={t('close')}
          onClick={() => close(true)}
          className="rounded px-1.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {mode === 'button' && (
        <div className="border-b border-border px-3 py-2">
          <input
            ref={searchBox}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            value={search}
            dir="auto"
            data-testid="saved-reply-search"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={keyDown}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      )}

      <div className="max-h-64 overflow-y-auto">
        {found.isPending ? (
          <div className="flex justify-center p-4" role="status" aria-label={t('loading')}>
            <Spinner />
          </div>
        ) : found.isError ? (
          <p role="alert" className="p-3 text-sm text-danger">
            {t('loadFailed')}{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void found.refetch()}
            >
              {t('retry')}
            </button>
          </p>
        ) : rows.length === 0 ? (
          <p
            role="status"
            className="p-3 text-sm text-muted-foreground"
            data-testid="saved-reply-empty"
          >
            {searching
              ? t('noMatch', { q: query })
              : total === 0
                ? t('empty')
                : t('emptyForChannel')}{' '}
            {canManage && !searching && total === 0 && (
              <Link href="/inbox/saved-replies" className="font-semibold underline">
                {t('createFirst')}
              </Link>
            )}
          </p>
        ) : (
          <ul id={listId} role="listbox" aria-label={t('listLabel')} className="py-1">
            {rows.map((r, i) => (
              <li
                key={r.id}
                id={optionId(listId, r.id)}
                role="option"
                aria-selected={i === active}
                data-testid="saved-reply-option"
                onMouseMove={() => setActive(i)}
                // The box keeps the focus: a click must not take it, and the pick happens on mousedown's click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(r)}
                className={cn(
                  'flex cursor-pointer items-start gap-3 px-3 py-2 text-sm',
                  i === active ? 'bg-primary/10' : 'hover:bg-muted',
                  busyId === r.id && 'opacity-60',
                )}
              >
                <span
                  dir="ltr"
                  className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                >
                  /{r.shortcut}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{r.title}</span>
                    {r.scope === 'mine' && <Badge tone="neutral">{t('mine')}</Badge>}
                  </span>
                  <span
                    dir="auto"
                    className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"
                  >
                    {r.body}
                  </span>
                </span>
                {busyId === r.id && <Spinner />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {problem && (
        <p role="alert" className="border-t border-border px-3 py-2 text-xs text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{t('hint')}</span>
        {canManage && (
          <Link href="/inbox/saved-replies" className="font-semibold hover:text-foreground">
            {t('manage')}
          </Link>
        )}
      </div>
    </div>
  );
}
