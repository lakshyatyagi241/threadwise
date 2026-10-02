'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { TABS, tabCount, type CountsLike, type TaskTab } from '../lib/filters';

/**
 * My tasks, All tasks, Overdue, Today, Upcoming, Completed, each with a count badge when the server sends counts.
 * Arrow keys move between tabs, Home and End jump. The panel is the list below, which follows the active tab.
 */
export function TasksTabs({
  value,
  onChange,
  counts,
  panelId,
}: {
  value: TaskTab;
  onChange: (tab: TaskTab) => void;
  counts: CountsLike | undefined;
  panelId: string;
}) {
  const t = useTranslations('tasks.tabs');
  const base = useId();

  const onKey = (e: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    const rtl = document.dir === 'rtl';
    const next =
      e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? (index + 1) % TABS.length
        : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? (index - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(TABS[next]!);
    document.getElementById(`${base}-${TABS[next]}`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t('label')}
      className="thin-scrollbar flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border"
    >
      {TABS.map((tab, i) => {
        const n = tabCount(tab, counts);
        const selected = tab === value;
        const alarm = tab === 'overdue' && (n ?? 0) > 0;
        return (
          <button
            key={tab}
            id={`${base}-${tab}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
              selected
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab)}
            {n !== undefined && (
              <span
                aria-label={t('count', { count: n })}
                className={cn(
                  'min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums',
                  alarm
                    ? 'bg-danger/15 text-danger'
                    : selected
                      ? 'bg-brand/15 text-brand dark:text-primary'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {n.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
