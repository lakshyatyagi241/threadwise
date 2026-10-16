'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Popover, Spinner, cn } from '@crm/ui';
import type { TagScope } from '../lib/list';
import { useTags } from '../api/hooks';
import { TagIcon } from './icons';
import { TagChip } from './tag-chip';

export interface TagFilterProps {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Whether the chosen tags are matched on the conversation's own tags or on its contact's tags. */
  scope: TagScope;
  onScopeChange: (scope: TagScope) => void;
}

/**
 * The list's tag filter: a multi-select of the workspace tags. A thread shows when it carries ANY of the chosen tags, either on the
 * thread itself ("Conversation tags") or on its contact ("Contact tags"): the toggle at the top picks which. The choice lives in the
 * address (`?tags=a,b&tagScope=conversation|contact`), so a filtered view can be shared or reloaded.
 */
export function TagFilter({ value, onChange, scope, onScopeChange }: TagFilterProps) {
  const t = useTranslations('team-inbox-conversations.tags');
  const [open, setOpen] = useState(false);
  const library = useTags(true);
  const chosen = new Set(value);
  const tags = library.data?.data ?? [];
  // A tag that was deleted since the address was made is dropped from the count.
  const active =
    value.filter((id) => tags.some((l) => l.id === id)).length || (library.data ? 0 : value.length);

  if (library.data && tags.length === 0 && value.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="inbox-tag-filter"
        aria-expanded={open}
        aria-label={t('filter')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
          active > 0 && 'border-primary text-primary',
        )}
      >
        <TagIcon className="size-4" />
        <span className="sr-only">
          {active > 0 ? t('filterActive', { count: active }) : t('filter')}
        </span>
        {active > 0 && (
          <span aria-hidden="true" className="text-[11px] font-semibold">
            {active}
          </span>
        )}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('filter')}
        className="start-0 end-auto w-64"
      >
        <div
          role="group"
          aria-label={t('scope.label')}
          data-testid="inbox-tag-scope"
          className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-xs"
        >
          {(['conversation', 'contact'] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`inbox-tag-scope-${s}`}
              aria-pressed={scope === s}
              onClick={() => onScopeChange(s)}
              className={cn(
                'rounded px-2 py-1 font-medium focus-visible:ring-2 focus-visible:ring-primary',
                scope === s
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
        {library.isPending && <Spinner />}
        <ul className="max-h-60 space-y-0.5 overflow-y-auto thin-scrollbar">
          {tags.map((l) => (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={chosen.has(l.id)}
                  onChange={() =>
                    onChange(chosen.has(l.id) ? value.filter((v) => v !== l.id) : [...value, l.id])
                  }
                />
                <TagChip tag={l} className="max-w-[10rem] text-xs" />
                {scope === 'conversation' && (
                  <span className="ms-auto text-xs text-muted-foreground">
                    {l.conversationCount}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('clearFilter')}
          </button>
        )}
      </Popover>
    </div>
  );
}
