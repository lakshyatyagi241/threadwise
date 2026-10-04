'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { firstName, greetingKey } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { jumpSearch } from './command-palette-model';
import { MenuIcon, NavIcon } from './nav-icons';
import type { WalletChipData } from './top-bar';
import { HeaderTools, RoundFrame } from './header-controls';
import { UserMenu, type ShellUser } from './user-menu';

// --- A clock that ticks every 20 seconds, empty on the server so hydration matches --------------------------------------

let clock = 0;
const clockListeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      clock = Date.now();
      clockListeners.forEach((l) => l());
    }, 20_000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
const readClock = () => (clock ||= Date.now());
const useNow = (): number => useSyncExternalStore(subscribeClock, readClock, () => 0);

export interface JumpEntry {
  label: string;
  group: string;
  href: string;
}

/** The "search or jump to" box (WD-ASHELL-016): eight matches at most, arrows move, Enter opens, Escape closes. */
function JumpBox({ index }: { index: readonly JumpEntry[] }) {
  const t = useTranslations('admin-console-shell.strip');
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = useMemo(() => jumpSearch(index, query), [index, query]);
  const go = (e: JumpEntry | undefined) => {
    if (!e) return;
    setOpen(false);
    setQuery('');
    router.push(e.href);
  };
  return (
    <div className="relative ms-4 hidden max-w-[520px] flex-1 md:block">
      <NavIcon
        name="search"
        className="pointer-events-none absolute start-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={ref}
        id="ts-search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-label={t('jump')}
        placeholder={t('jump')}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
          setOpen(true);
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
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-full border border-border bg-muted/50 py-2 pe-12 ps-10 text-[12.5px] outline-none transition focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary"
      />
      <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:block">
        ⌘K
      </kbd>
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute start-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-background p-1 shadow-lg"
        >
          {results.map((r, i) => (
            <li
              key={r.href}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={(e) => {
                e.preventDefault();
                go(r);
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm',
                i === cursor && 'bg-muted',
              )}
            >
              <Highlight text={r.label} query={query} />
              <span className="text-xs text-muted-foreground">{r.group}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-primary">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </span>
  );
}

/** "Good morning, Priya" over the viewer's own date and time (WD-ASHELL-016); it shows nothing until the browser has a clock. */
function Greeting({ name }: { name: string }) {
  const t = useTranslations('admin-console-shell.strip.greeting');
  const locale = useLocale();
  const now = useNow();
  const d = new Date(now || 0);
  const who = firstName(name);
  return (
    <div className="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex">
      {now ? (
        <div className="select-none text-center leading-tight" data-testid="greeting">
          <div className="text-[12.5px] font-semibold">
            {t(greetingKey(d.getHours()))}
            {who ? `, ${who}` : ''}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            {new Intl.DateTimeFormat(locale, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            }).format(d)}
            {' · '}
            {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)}
          </div>
        </div>
      ) : (
        <div className="h-9 w-40" aria-hidden="true" />
      )}
    </div>
  );
}

export interface TopStripProps {
  user: ShellUser;
  theme: 'light' | 'dark';
  onOpenMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  /** The breadcrumb's page name: the active menu entry. */
  pageTitle: string;
  brand: string;
  jumpIndex: readonly JumpEntry[];
  wallet?: WalletChipData;
  bell?: ReactNode;
  /** The gear for the settings behind the current screen (`PageSettingsShortcut`). */
  pageSettings?: ReactNode;
  settingsHref?: string;
  helpItems?: readonly ResolvedNavItem[];
}

/**
 * The slim strip of sidebar mode (WD-ASHELL-016), exactly 64 pixels so full-height pages can use `100vh - 64px`: breadcrumb,
 * a jump box over the pages this person can reach, a greeting with a live clock, then balance, bell and the account menu.
 */
export function TopStrip({
  user,
  theme,
  onOpenMenu,
  menuButtonRef,
  pageTitle,
  brand,
  jumpIndex,
  bell,
  pageSettings,
  settingsHref,
  helpItems,
}: TopStripProps) {
  const t = useTranslations('shell');
  return (
    <header
      data-shell="strip"
      className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background px-3 sm:px-4"
    >
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label={t('openMenu')}
        className="flex size-9 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary md:hidden"
      >
        <MenuIcon />
      </button>
      <nav
        aria-label="breadcrumb"
        className="flex min-w-0 items-center gap-2.5 font-mono text-[11.5px] uppercase tracking-widest text-muted-foreground"
      >
        <span className="hidden sm:inline">{brand}</span>
        <NavIcon name="chevron-right" className="hidden size-3 sm:block" />
        <span className="truncate text-foreground">{pageTitle}</span>
      </nav>
      <JumpBox index={jumpIndex} />
      <Greeting name={user.fullName} />
      <div className="ms-auto flex shrink-0 items-center gap-2 lg:ms-0">
        <HeaderTools theme={theme} />
        <RoundFrame>{pageSettings}</RoundFrame>
        <RoundFrame>{bell}</RoundFrame>
        <UserMenu
          user={user}
          theme={theme}
          settingsHref={settingsHref}
          helpItems={helpItems}
          variant="strip"
        />
      </div>
    </header>
  );
}
