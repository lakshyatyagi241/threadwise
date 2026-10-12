'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@crm/ui';
import { memberLabel, type MentionMember } from '../lib/mentions';

/** How long typing stops before the members are asked for: one request per pause, not per key. */
export const MENTION_DEBOUNCE_MS = 150;

/**
 * The members matching what follows the `@`. The newest answer wins (a slow answer to an older query never replaces a newer one) and a
 * failed search reads as an empty list: the person can still type the message without a mention.
 */
export function useMentionSearch(
  search: (q: string) => Promise<MentionMember[]>,
  query: string | null,
): { items: MentionMember[]; loading: boolean } {
  const [result, setResult] = useState<{ query: string; items: MentionMember[] } | null>(null);
  useEffect(() => {
    if (query === null) return;
    let live = true;
    const h = setTimeout(() => {
      search(query)
        .then((items) => live && setResult({ query, items }))
        .catch(() => live && setResult({ query, items: [] }));
    }, MENTION_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [search, query]);
  // Only the answer to what is typed now is shown; an older answer never stands in for it.
  const fresh = query !== null && result?.query === query;
  return { items: fresh ? result.items : [], loading: query !== null && !fresh };
}

/**
 * The list of members that opens above the box while an `@` is being typed. Names and numbers are drawn as text, never as markup.
 * Keyboard: Arrow keys and Enter or Tab are handled by the composer (the box keeps focus); a click picks too.
 */
export function MentionList({
  items,
  loading,
  active,
  onPick,
}: {
  items: readonly MentionMember[];
  loading: boolean;
  active: number;
  onPick: (m: MentionMember) => void;
}) {
  const t = useTranslations('team-inbox-conversations.groupThread.mention');
  return (
    <div
      role="listbox"
      aria-label={t('label')}
      data-testid="inbox-mention-list"
      className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-56 overflow-y-auto rounded-md border border-border bg-background py-1 shadow-lg"
    >
      {items.length === 0 ? (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {loading ? t('loading') : t('none')}
        </p>
      ) : (
        items.map((m, i) => (
          <button
            key={m.jid}
            type="button"
            role="option"
            aria-selected={i === active}
            data-testid="inbox-mention-option"
            // The box keeps focus: a mouse down would move it before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(m)}
            className={cn(
              'flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-sm',
              i === active ? 'bg-muted' : 'hover:bg-muted/60',
            )}
          >
            <span className="truncate font-medium" dir="auto">
              {memberLabel(m)}
            </span>
            {m.name && m.phone && (
              <span className="truncate text-xs text-muted-foreground" dir="ltr">
                {m.phone}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
