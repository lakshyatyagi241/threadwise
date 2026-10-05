'use client';

import Link from 'next/link';
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
    <div className="relative hidden w-72 md:block">
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
        className="h-9 w-full rounded-full border border-border bg-muted/50 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
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
  if (!now) return <div className="hidden h-9 w-40 lg:block" aria-hidden="true" />;
  const d = new Date(now);
  const who = firstName(name);
  return (
    <div className="hidden text-end leading-tight lg:block" data-testid="greeting">
      <div className="text-sm font-medium">
        {t(greetingKey(d.getHours()))}
        {who ? `, ${who}` : ''}
      </div>
      <div className="text-xs text-muted-foreground">
        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)}
      </div>
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
  wallet,
  bell,
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
      <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="hidden text-muted-foreground sm:inline">{brand}</span>
        <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
          ›
        </span>
        <span className="truncate font-medium">{pageTitle}</span>
      </nav>
      <div className="ms-auto flex items-center gap-3">
        <JumpBox index={jumpIndex} />
        <Greeting name={user.fullName} />
        {wallet && (
          <Link
            href={wallet.href ?? '/billing/wallet'}
            className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary xl:inline-flex"
          >
            <NavIcon name="payment" className="size-4" />
            <span className="tabular-nums">{wallet.label}</span>
          </Link>
        )}
        {bell}
        <UserMenu user={user} theme={theme} settingsHref={settingsHref} helpItems={helpItems} />
      </div>
    </header>
  );
}
