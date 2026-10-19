'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import type { ResolvedNavItem } from '@/features/_registry/types';
import {
  SEARCH_EVENT,
  buildPalette,
  searchPalette,
  type PaletteEntry,
} from './command-palette-model';

const NS = 'admin-console-shell.palette';

/** The search box of the screen behind the palette (the contacts box, a list's filter), when it has one. */
function findPageSearch(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'main input[type="search"], main input[role="searchbox"], main [data-page-search]',
  );
}

/** Puts `query` into the screen's own search box and lets its handlers see it, as if it had been typed there. */
function searchOnPage(query: string): void {
  const input = findPageSearch();
  if (!input) return;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, query);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The Ctrl/Cmd+K palette (TW-ASHELL-019): jump to any page the person can open. It lists the same menu entries and Settings
 * tiles the menu draws, so it is already filtered by permission, and finds them by name, description or hidden words.
 */
export function CommandPalette({
  nav,
  tiles,
}: {
  nav: readonly ResolvedNavItem[];
  tiles: readonly ResolvedSettingsTile[];
}) {
  const t = useTranslations(NS);
  const tAll = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const isOpen = useRef(false);
  const listId = useId();

  const entries = useMemo(
    () =>
      buildPalette(nav, tiles, (k) => tAll(k), [
        {
          id: 'account:profile',
          title: t('entries.profile'),
          description: t('entries.profileHint'),
          href: '/account/profile',
          tag: 'account',
          keywords: 'account me name email photo',
        },
        {
          id: 'account:security',
          title: t('entries.password'),
          description: t('entries.passwordHint'),
          href: '/account/security',
          tag: 'account',
          keywords: 'password two-factor 2fa sessions security',
        },
      ]),
    [nav, tiles, t, tAll],
  );
  const results = useMemo(() => searchPalette(entries, query), [entries, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        // A screen with its own Ctrl K (the contacts box, the Help search) already took the key: it wins on its own page.
        if (e.defaultPrevented && !isOpen.current) return;
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    isOpen.current = open;
    if (open) input.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  };
  const pageSearch = query.trim() !== '' && results.length === 0 && findPageSearch() !== null;
  const go = (e: PaletteEntry | undefined) => {
    if (!e) {
      // Nothing to open: fall back to the screen's own search with what was typed.
      if (pageSearch) {
        const q = query.trim();
        close();
        searchOnPage(q);
      }
      return;
    }
    close();
    router.push(e.href);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[cursor] ? `${listId}-${cursor}` : undefined}
          value={query}
          placeholder={t('placeholder')}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(results[cursor]);
            }
          }}
          className="h-14 w-full border-b border-border bg-transparent px-5 text-base outline-none"
        />
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && !pageSearch && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('empty', { query })}
            </li>
          )}
          {pageSearch && (
            <li
              role="option"
              aria-selected="true"
              onClick={() => go(undefined)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <span className="block truncate font-medium">
                {t('searchPage', { query: query.trim() })}
              </span>
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                i === cursor ? 'bg-muted' : '',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.title}</span>
                {r.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.description}
                  </span>
                )}
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`tags.${r.tag}`)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{t('hintNavigate')}</span>
          <span>{t('hintOpen')}</span>
          <span className="ms-auto">{t('hintToggle')}</span>
        </div>
      </div>
    </div>
  );
}
