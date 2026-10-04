'use client';

import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { dirOf } from '@/i18n/locales';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { useStoredValue } from '@/lib/use-stored-value';
import { NavCollapsedContext } from './nav-context';
import { useOptionalShellData } from './shell-data';
import { BrandMark, ChevronIcon, CloseIcon, NavIcon } from './nav-icons';
import { railSections, type NavSection } from './nav-model';

/** The Settings group is pinned under the scrolling list, always in reach; everything else scrolls. */
function splitBottom(sections: readonly NavSection[]) {
  return {
    main: sections.filter((s) => s.group !== 'settings'),
    bottom: sections.filter((s) => s.group === 'settings').flatMap((s) => s.items),
  };
}

type Translate = ReturnType<typeof useTranslations>;

function Pill({ tone, children }: { tone: 'new' | 'soon' | 'upgrade'; children: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
        tone === 'new' && 'bg-nav-badge text-nav-badge-foreground',
        tone === 'soon' && 'bg-nav-hover text-nav-muted',
        tone === 'upgrade' && 'bg-nav-badge/15 text-nav-badge',
      )}
    >
      {children}
    </span>
  );
}

/** One row of the labelled panel (wide rail and mobile drawer). */
function PanelItem({
  item,
  active,
  t,
  onNavigate,
}: {
  item: ResolvedNavItem;
  active: boolean;
  t: Translate;
  onNavigate?: () => void;
}) {
  const label = t(item.labelKey);
  const body = (
    <>
      <NavIcon name={item.icon} className="size-[18px]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.comingSoon ? (
        <Pill tone="soon">{t('shell.soon')}</Pill>
      ) : item.locked ? (
        <Pill tone="upgrade">{t('shell.locked')}</Pill>
      ) : item.badge === 'new' ? (
        <Pill tone="new">{t('shell.new')}</Pill>
      ) : null}
    </>
  );
  const row = 'relative flex items-center gap-3 rounded-xl px-3 py-[9px] text-[13.5px] font-medium';
  if (item.comingSoon) {
    return (
      <span
        aria-disabled="true"
        title={t('shell.comingSoon')}
        className={cn(row, 'cursor-not-allowed text-nav-disabled')}
      >
        {body}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        row,
        'outline-none transition focus-visible:ring-2 focus-visible:ring-nav-ring',
        active
          ? 'bg-nav-active text-nav-active-foreground before:absolute before:-start-3 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-e-[3px] before:bg-nav-accent'
          : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-active-foreground',
      )}
    >
      {body}
    </Link>
  );
}

/**
 * Every group with its heading, coming-soon entries included. Used by the pinned panel and the mobile drawer.
 * A section is only ever built from items that survived the menu's gates, so a group with nothing visible has no
 * heading (an empty one is skipped here as well).
 */
export const NAV_COLLAPSED_KEY = 'shell:nav:collapsed';

/** Collapsed group ids, remembered per browser (WaDesk: localStorage, not per user or workspace). */
export function parseCollapsed(raw: string | null): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

export function NavPanel({
  sections,
  activeId,
  onNavigate,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const tg = useTranslations('admin-console-shell.shell');
  const uid = useId();
  const [raw, setRaw] = useStoredValue(NAV_COLLAPSED_KEY);
  const collapsed = parseCollapsed(raw);
  const toggle = (group: string) =>
    setRaw(
      JSON.stringify(
        collapsed.includes(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group],
      ),
    );
  return (
    <nav aria-label={t('shell.mainMenu')} className="px-3 py-2">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => {
          const headingId = `${uid}-${section.group}`;
          const listId = `${uid}-list-${section.group}`;
          // The group holding the current page is always open, so the active entry is never hidden.
          const holdsActive = section.items.some((i) => i.id === activeId);
          const shut = collapsed.includes(section.group) && !holdsActive;
          return (
            <div key={section.group} role="group" aria-labelledby={headingId}>
              <button
                id={headingId}
                type="button"
                aria-expanded={!shut}
                aria-controls={listId}
                aria-label={tg('toggleGroup', { group: t(`shell.groups.${section.group}`) })}
                onClick={() => toggle(section.group)}
                className="mb-1.5 mt-4 flex w-full items-center justify-between gap-2 rounded px-3 text-start font-mono text-[9px] uppercase tracking-[0.18em] text-nav-muted outline-none hover:text-nav-foreground focus-visible:ring-2 focus-visible:ring-nav-ring"
              >
                <span>{t(`shell.groups.${section.group}`)}</span>
                <ChevronIcon
                  dir="down"
                  className={cn(
                    'size-[11px] opacity-60 transition-transform',
                    shut && '-rotate-90',
                  )}
                />
              </button>
              <ul id={listId} hidden={shut} className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <PanelItem
                      item={item}
                      active={item.id === activeId}
                      t={t}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </nav>
  );
}

/** Brand mark and wordmark at the top of the panel. */
function PanelBrand({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const t = useTranslations();
  const tc = useTranslations('admin-console-shell.shell');
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label={collapsed ? t('common.appName') : undefined}
      className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-nav-ring"
    >
      <BrandMark className="size-8" />
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-serif text-xl tracking-tight text-nav-active-foreground">
            {t('common.appName')}
          </span>
          <span className="block font-mono text-[8.5px] uppercase tracking-[0.2em] text-nav-muted">
            {tc('railCaption')}
          </span>
        </span>
      )}
    </Link>
  );
}

interface Tip {
  label: string;
  top: number;
  edge: number;
}

/**
 * The navigation column (light in the light theme, dark in the dark theme): brand at the top, the list (a slim icon rail by default, the grouped
 * panel when pinned open) scrolling in the middle with a thin scrollbar, and a footer that stays put (the workspace
 * card, then the pin button). The pinned choice is remembered per browser by the shell.
 */
export function NavRail({
  sections,
  activeId,
  pinned,
  onTogglePinned,
  footer,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  pinned: boolean;
  onTogglePinned: () => void;
  /** Card under the list (the workspace switcher); it shrinks to its avatar when the rail is slim. */
  footer?: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const rtl = dirOf(locale) === 'rtl';
  const [tip, setTip] = useState<Tip | null>(null);

  const show = (el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({
      label,
      top: r.top + r.height / 2,
      edge: rtl ? window.innerWidth - r.left + 10 : r.right + 10,
    });
  };

  const toggleLabel = t(pinned ? 'shell.collapseMenu' : 'shell.expandMenu');
  const { main, bottom } = splitBottom(sections);
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-nav-border bg-nav text-nav-foreground md:flex',
        'transition-[width] duration-200 motion-reduce:transition-none',
        pinned ? 'w-64' : 'w-[4.5rem]',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-nav-border',
          pinned ? 'px-4' : 'justify-center',
        )}
      >
        <PanelBrand collapsed={!pinned} />
        {pinned && (
          <div className="ms-auto">
            <>
              <button
                type="button"
                onClick={() => {
                  setTip(null);
                  onTogglePinned();
                }}
                aria-expanded={pinned}
                aria-label={toggleLabel}
                title={pinned ? undefined : toggleLabel}
                className={cn(
                  'flex items-center gap-3 rounded-xl text-sm text-nav-muted outline-none transition',
                  'hover:bg-nav-hover hover:text-nav-active-foreground focus-visible:ring-2 focus-visible:ring-nav-ring',
                  'size-9 justify-center',
                )}
              >
                <ChevronIcon dir={pinned === rtl ? 'right' : 'left'} className="size-[18px]" />
              </button>
            </>
          </div>
        )}
      </div>
      {!pinned && (
        <div className="flex shrink-0 justify-center border-b border-nav-border py-2">
          <>
            <button
              type="button"
              onClick={() => {
                setTip(null);
                onTogglePinned();
              }}
              aria-expanded={pinned}
              aria-label={toggleLabel}
              title={pinned ? undefined : toggleLabel}
              className={cn(
                'flex items-center gap-3 rounded-xl text-sm text-nav-muted outline-none transition',
                'hover:bg-nav-hover hover:text-nav-active-foreground focus-visible:ring-2 focus-visible:ring-nav-ring',
                'size-9 justify-center',
              )}
            >
              <ChevronIcon dir={pinned === rtl ? 'right' : 'left'} className="size-[18px]" />
            </button>
          </>
        </div>
      )}
      {pinned && footer && (
        <div
          data-testid="rail-workspace"
          className="shrink-0 p-3 pb-1 [&_[role=menu]]:bottom-auto [&_[role=menu]]:top-full [&_[role=menu]]:mb-0 [&_[role=menu]]:mt-2"
        >
          <NavCollapsedContext.Provider value={false}>{footer}</NavCollapsedContext.Provider>
        </div>
      )}
      <div className="thin-scrollbar nav-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {pinned ? (
          <NavPanel sections={main} activeId={activeId} />
        ) : (
          <RailIcons
            sections={railSections(main)}
            activeId={activeId}
            show={show}
            hide={() => setTip(null)}
          />
        )}
      </div>
      {bottom.length > 0 && (
        <nav
          aria-label={t('shell.settings')}
          className={cn(
            'shrink-0 border-t border-nav-border',
            pinned ? 'space-y-0.5 px-3 py-2' : 'flex flex-col items-center gap-1 px-2 py-2',
          )}
        >
          {bottom.map((item) =>
            pinned ? (
              <PanelItem key={item.id} item={item} active={item.id === activeId} t={t} />
            ) : (
              <RailLink
                key={item.id}
                item={item}
                active={item.id === activeId}
                show={show}
                hide={() => setTip(null)}
              />
            ),
          )}
        </nav>
      )}
      {pinned ? (
        <WalletCard />
      ) : (
        footer && (
          <div className="shrink-0 space-y-2 border-t border-nav-border p-3">
            <NavCollapsedContext.Provider value={true}>{footer}</NavCollapsedContext.Provider>
          </div>
        )
      )}
      {/* Portalled to <body>: inside the aside the page content would paint over the label. */}
      {tip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="presentation"
            aria-hidden="true"
            className="pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg"
            style={{ top: tip.top, ...(rtl ? { right: tip.edge } : { left: tip.edge }) }}
          >
            {tip.label}
          </div>,
          document.body,
        )}
    </aside>
  );
}

/** WaDesk's wallet card at the foot of the rail: caption and plan chip, the balance, and a "Top up" button (WD-ASHELL-015). */
function WalletCard() {
  const tw = useTranslations('admin-console-shell.shell');
  const profile = useOptionalShellData()?.profile;
  if (!profile?.walletLabel) return null;
  return (
    <div className="shrink-0 p-3.5" data-testid="rail-wallet">
      <div className="rounded-2xl border border-nav-border bg-nav-hover/60 p-3.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-widest text-nav-muted">
            {tw('wallet')}
          </span>
          <span className="rounded-full bg-nav-accent/15 px-2 py-0.5 font-mono text-[9px] text-nav-accent">
            {profile.plan}
          </span>
        </div>
        <div className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums text-nav-active-foreground">
          {profile.walletLabel}
        </div>
        <Link
          href="/billing/wallet"
          className="mt-2.5 block w-full rounded-full bg-nav-accent py-1.5 text-center text-[11.5px] font-semibold text-black outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-nav-ring"
        >
          {tw('topUp')}
        </Link>
      </div>
    </div>
  );
}

/** One icon of the slim rail, with its tooltip. */
function RailLink({
  item,
  active,
  show,
  hide,
}: {
  item: ResolvedNavItem;
  active: boolean;
  show: (el: HTMLElement, label: string) => void;
  hide: () => void;
}) {
  const t = useTranslations();
  const label = t(item.labelKey);
  return (
    <Link
      href={item.href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={(e) => show(e.currentTarget, label)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget, label)}
      onBlur={hide}
      className={cn(
        'relative flex size-11 items-center justify-center rounded-xl outline-none transition',
        'focus-visible:ring-2 focus-visible:ring-nav-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav',
        active
          ? 'bg-nav-active text-nav-active-foreground'
          : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-active-foreground',
      )}
    >
      <NavIcon name={item.icon} />
      {item.badge === 'new' && (
        <span className="absolute -end-1 -top-1 rounded-full bg-nav-badge px-1 py-0.5 text-[8px] font-bold uppercase leading-none text-nav-badge-foreground">
          {t('shell.new')}
        </span>
      )}
      {item.locked && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 end-1 size-2 rounded-full bg-nav-badge ring-2 ring-nav"
        />
      )}
    </Link>
  );
}

function RailIcons({
  sections,
  activeId,
  show,
  hide,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  show: (el: HTMLElement, label: string) => void;
  hide: () => void;
}) {
  const t = useTranslations();
  return (
    <nav aria-label={t('shell.mainMenu')} className="flex flex-col items-center gap-1 px-2 py-3">
      {sections.map((section, i) => (
        <div
          key={section.group}
          role="group"
          aria-label={t(`shell.groups.${section.group}`)}
          className={cn(
            'flex w-full flex-col items-center gap-1',
            i > 0 && 'mt-1 border-t border-nav-border pt-2',
          )}
        >
          {section.items.map((item) => (
            <RailLink
              key={item.id}
              item={item}
              active={item.id === activeId}
              show={show}
              hide={hide}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Mobile: the labelled panel slides in over the page. Escape, the backdrop and the close button dismiss it. */
export function NavDrawer({
  open,
  onClose,
  sections,
  activeId,
  returnFocusTo,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  sections: readonly NavSection[];
  activeId: string | undefined;
  returnFocusTo: React.RefObject<HTMLElement | null>;
  footer?: ReactNode;
}) {
  const t = useTranslations();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { main, bottom } = splitBottom(sections);

  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusTo.current;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      returnTo?.focus();
    };
  }, [open, onClose, returnFocusTo]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('shell.closeMenu')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.mainMenu')}
        className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-nav text-nav-foreground shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-nav-border px-4">
          <PanelBrand onNavigate={onClose} />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('shell.closeMenu')}
            className="flex size-9 items-center justify-center rounded-md text-nav-foreground outline-none hover:bg-nav-hover focus-visible:ring-2 focus-visible:ring-nav-ring"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="thin-scrollbar nav-scrollbar min-h-0 flex-1 overflow-y-auto">
          <NavPanel sections={main} activeId={activeId} onNavigate={onClose} />
        </div>
        {bottom.length > 0 && (
          <nav
            aria-label={t('shell.settings')}
            className="shrink-0 space-y-0.5 border-t border-nav-border px-3 py-2"
          >
            {bottom.map((item) => (
              <PanelItem
                key={item.id}
                item={item}
                active={item.id === activeId}
                t={t}
                onNavigate={onClose}
              />
            ))}
          </nav>
        )}
        {footer && (
          <div className="shrink-0 border-t border-nav-border p-3">
            <NavCollapsedContext.Provider value={false}>{footer}</NavCollapsedContext.Provider>
          </div>
        )}
      </div>
    </div>
  );
}
