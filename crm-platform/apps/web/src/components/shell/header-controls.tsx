'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { Popover, cn } from '@crm/ui';
import { LocaleSwitcher } from '@/features/localization-translation/locale-switcher';
import { NavIcon } from './nav-icons';
import { setTheme } from './actions';

/** Reference's round header button: 36 px, hairline border, hover tint. */
export const ROUND_BUTTON =
  'flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground/80 outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/** The round search button: opens the command palette (Ctrl+K). */
export function SearchButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(ROUND_BUTTON, 'hidden md:flex')}
    >
      <NavIcon name="search" className="size-3.5" />
    </button>
  );
}

/**
 * The theme button (TW-ASHELL-024): a round moon or sun that opens a small "Theme" menu. Reference offers paper, bright, dark and
 * doodle; this app ships light and dark (an intended difference), and one cookie serves the header and Settings.
 */
export function ThemeMenu({ theme }: { theme: 'light' | 'dark' }) {
  const t = useTranslations('shell');
  const [current, setCurrent] = useState(theme);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  useEffect(() => {
    document.documentElement.dataset.theme = current;
  }, [current]);

  const pick = (next: 'light' | 'dark') => {
    setOpen(false);
    if (next === current) return;
    setCurrent(next);
    start(() => void setTheme(next));
  };
  const options = [
    { id: 'light' as const, label: t('themeLight'), swatch: 'bg-white' },
    { id: 'dark' as const, label: t('themeDark'), swatch: 'bg-neutral-900' },
  ];
  return (
    <div className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('theme')}
        title={t('theme')}
        data-testid="theme-menu"
        className={ROUND_BUTTON}
      >
        <NavIcon name={current === 'dark' ? 'moon' : 'sun'} className="size-3.5" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        label={t('theme')}
        className="w-48 space-y-0 rounded-2xl p-1.5"
      >
        <div className="px-2 pb-1 pt-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('theme')}
        </div>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="menuitemradio"
            aria-checked={current === o.id}
            onClick={() => pick(o.id)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
              current === o.id
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <span className={cn('size-4 shrink-0 rounded border border-border', o.swatch)} />
            <span className="flex-1">{o.label}</span>
            {current === o.id && <NavIcon name="check" className="size-3.5" />}
          </button>
        ))}
      </Popover>
    </div>
  );
}

/** Theme button and language switcher, in Reference's order, for every header mode. */
export function HeaderTools({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <>
      <ThemeMenu theme={theme} />
      <div className="hidden md:block">
        <LocaleSwitcher />
      </div>
    </>
  );
}

/**
 * Gives a bell or a gear that arrives from another domain Reference's round hairline frame without touching its code: the
 * button inside (one level down) gains the border and the background.
 */
export function RoundFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center [&>div>button]:border [&>div>button]:border-border [&>div>button]:bg-background [&>div>button]:text-foreground/80 [&>div>button>svg]:size-3.5">
      {children}
    </div>
  );
}
