'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type RefObject } from 'react';
import { SettingsIcon } from './settings-icons';

/**
 * The big "Search settings" box. Typing is handled by the frame (it debounces); Escape clears, the slash key anywhere on the
 * page focuses it, and the Down arrow moves into the first result.
 */
export function SettingsSearchBox({
  value,
  onChange,
  resultsRef,
}: {
  value: string;
  onChange: (next: string) => void;
  resultsRef: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('settings');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div role="search" className="relative">
      <label htmlFor="settings-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <span className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-muted-foreground">
        <SettingsIcon name="search" className="size-5" />
      </span>
      <input
        ref={input}
        id="settings-search"
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={t('searchPlaceholder')}
        aria-describedby="settings-search-hint"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          } else if (e.key === 'ArrowDown') {
            const first = resultsRef.current?.querySelector<HTMLElement>('[data-settings-result]');
            if (first) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
        className="h-12 w-full rounded-xl border border-border bg-background pe-12 ps-12 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          aria-label={t('clearSearch')}
          className="absolute inset-y-0 end-2 my-auto flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
            className="size-4"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
      <p id="settings-search-hint" className="sr-only">
        {t('searchHint')}
      </p>
    </div>
  );
}
