'use client';

import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { cn } from '@crm/ui';
import { ConsoleIcon } from './console-icons';
import { defaultEntries, searchEntries, type SearchEntry } from './console-search';

const neverChanges = () => undefined;
const subscribeNever = () => neverChanges;

/** True on Apple devices, where the shortcut is Command+K. The server and the first client render say false, so nothing mismatches. */
export function useIsApple(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    () => false,
  );
}

/**
 * The console search (WD-ASHELL-019): Ctrl+K or Command+K opens a 640px card over a blurred backdrop. Empty, it lists the
 * first few pages of the menu; typed, it lists up to 12 pages whose name, section, keywords or address match every word.
 * Arrows move, Enter opens, Escape or a click outside closes. It is a dialog with a combobox input, mounted only while
 * open so every opening starts clean, and it hands focus back to whatever had it.
 */
export function ConsolePalette({
  index,
  onSelect,
  onClose,
}: {
  index: readonly SearchEntry[];
  onSelect: (entry: SearchEntry) => void;
  onClose: () => void;
}) {
  const t = useTranslations('admin-console-shell.search');
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const apple = useIsApple();

  const trimmed = query.trim();
  const options = useMemo(
    () => (trimmed ? searchEntries(index, trimmed) : defaultEntries(index)),
    [index, trimmed],
  );
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const optionId = (i: number) => `${listId}-option-${i}`;

  // Focus the field now, give focus back on close, and keep the page behind from scrolling.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, trimmed, listId]);

  const move = (dir: 1 | -1) => {
    if (options.length === 0) return;
    setActive((activeIndex + dir + options.length) % options.length);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) onSelect(option);
    } else if (e.key === 'Escape') {
      // Closes the search only. The menu drawer listens for Escape on the document too, and React's own listener
      // is registered first, so stopping the event right here keeps that later listener from seeing it.
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // The field is the only stop; the results are reached with the arrows.
      e.preventDefault();
    }
  };

  const kbd = 'rounded border border-border px-1';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('label')}
      data-testid="console-palette"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3 pt-[10vh] backdrop-blur-sm sm:pt-[12vh]"
    >
      <div className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <ConsoleIcon name="search" className="size-5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options.length > 0 ? optionId(activeIndex) : undefined}
            aria-label={t('label')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t('placeholder')}
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        {/* Keeps the field focused when a result is clicked, so the keyboard keeps working. */}
        <ul
          id={listId}
          role="listbox"
          aria-label={t('label')}
          onMouseDown={(e) => e.preventDefault()}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {options.map((entry, i) => (
            <li
              key={entry.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              data-href={entry.href}
              onMouseMove={() => setActive(i)}
              onClick={() => onSelect(entry)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm',
                i === activeIndex && 'bg-muted',
              )}
            >
              <span className="min-w-0 truncate font-medium">{entry.label}</span>
              <span className="max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">
                {[entry.section, entry.caption].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
          {options.length === 0 && (
            <li
              role="presentation"
              className="px-3 py-8 text-center text-sm font-medium text-muted-foreground"
            >
              {t('noResults', { query: trimmed })}
            </li>
          )}
        </ul>

        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex">
          <span>
            <kbd className={kbd}>↑</kbd> <kbd className={kbd}>↓</kbd> {t('hintMove')}
          </span>
          <span>
            <kbd className={kbd}>↵</kbd> {t('hintOpen')}
          </span>
          <span>
            <kbd className={kbd}>{apple ? '⌘K' : 'Ctrl K'}</kbd> {t('hintToggle')}
          </span>
        </div>
        <div role="status" aria-live="polite" className="sr-only">
          {trimmed ? t('count', { count: options.length }) : ''}
        </div>
      </div>
    </div>
  );
}
