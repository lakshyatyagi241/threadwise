'use client';

import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { dirOf } from '@/i18n/locales';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { NavCollapsedContext } from './nav-context';
import { BrandMark, CloseIcon, NavIcon } from './nav-icons';
import { countBadge, groupCount, itemCount, useNavCounts } from './nav-badges';
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

/** The live number on a menu entry: "99+" past 99, announced as "N unread" to a screen reader. */
function CountPill({ count, t }: { count: number; t: Translate }) {
  return (
    <span
      data-testid="nav-count"
      className="shrink-0 rounded-full bg-nav-badge px-1.5 py-0.5 text-[10px] font-semibold leading-none text-nav-badge-foreground"
    >
      <span aria-hidden="true">{countBadge(count)}</span>
      <span className="sr-only">{t('shell.unreadCount', { count })}</span>
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
  const counts = useNavCounts();
  const count = itemCount(item, counts);
  const body = (
    <>
      <NavIcon name={item.icon} className="size-[18px]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && !item.comingSoon && !item.locked ? (
        <CountPill count={count} t={t} />
      ) : item.comingSoon ? (
        <Pill tone="soon">{t('shell.soon')}</Pill>
      ) : item.locked ? (
        <Pill tone="upgrade">{t('shell.locked')}</Pill>
      ) : item.badge === 'new' ? (
        <Pill tone="new">{t('shell.new')}</Pill>
      ) : null}
    </>
  );
  const row = 'flex items-center gap-3 rounded-xl px-3 py-2 text-sm';
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
          ? 'bg-nav-active font-semibold text-nav-active-foreground'
          : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-active-foreground',
      )}
    >
      {body}
    </Link>
  );
}

/**
 * Every group with its heading, coming-soon entries included. Used by the mobile drawer.
 * A section is only ever built from items that survived the menu's gates, so a group with nothing visible has no
 * heading (an empty one is skipped here as well).
 */
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
  const uid = useId();
  return (
    <nav aria-label={t('shell.mainMenu')} className="space-y-5 px-3 py-4">
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => {
          const headingId = `${uid}-${section.group}`;
          return (
            <div key={section.group} role="group" aria-labelledby={headingId}>
              <div
                id={headingId}
                className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-nav-muted"
              >
                {t(`shell.groups.${section.group}`)}
              </div>
              <ul className="space-y-0.5">
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
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label={collapsed ? t('common.appName') : undefined}
      className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-nav-ring"
    >
      <BrandMark className="size-8" />
      {!collapsed && (
        <span className="truncate text-base font-semibold tracking-tight text-nav-active-foreground">
          {t('common.appName')}
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
 * The navigation column (light in the light theme, dark in the dark theme): the brand at the top, one icon per menu group scrolling in
 * the middle (resting on or clicking an icon opens a panel with the group's entries), Settings under the list, and a footer that stays
 * put (the workspace card, shrunk to its avatar). There is no wide mode: the panels carry the labels. The mobile drawer still lists
 * every group with its heading.
 */
export function NavRail({
  sections,
  activeId,
  footer,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  /** Card under the list (the workspace switcher); it shrinks to its avatar. */
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

  const { main, bottom } = splitBottom(sections);
  return (
    // The rail is fixed to the viewport (sticky would stop following once the page is taller than its wrapper); the wrapper only
    // keeps its width in the layout so the page content starts beside it.
    <div className="hidden w-[4.5rem] shrink-0 md:block">
      <aside className="fixed inset-y-0 start-0 z-30 flex w-[4.5rem] flex-col border-e border-nav-border bg-nav text-nav-foreground">
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-nav-border">
          <PanelBrand collapsed />
        </div>
        <div className="thin-scrollbar nav-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <RailGroups
            sections={main}
            activeId={activeId}
            show={show}
            hide={() => setTip(null)}
            rtl={rtl}
          />
        </div>
        {bottom.length > 0 && (
          <nav
            aria-label={t('shell.pinned')}
            className="flex shrink-0 flex-col items-center gap-1 border-t border-nav-border px-2 py-2"
          >
            {bottom.map((item) => (
              <RailLink
                key={item.id}
                item={item}
                active={item.id === activeId}
                show={show}
                hide={() => setTip(null)}
              />
            ))}
          </nav>
        )}
        <div className="shrink-0 space-y-2 border-t border-nav-border p-3">
          {footer && <NavCollapsedContext.Provider value>{footer}</NavCollapsedContext.Provider>}
        </div>
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
    </div>
  );
}

/** The count on a rail icon, in its top corner. The words for a screen reader are in the link's label. */
function RailCount({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      data-testid="rail-count"
      className="absolute -end-1 -top-1 min-w-4 rounded-full bg-nav-badge px-1 py-0.5 text-center text-[9px] font-bold leading-none text-nav-badge-foreground ring-2 ring-nav"
    >
      {countBadge(count)}
    </span>
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
  const counts = useNavCounts();
  const count = item.locked ? 0 : itemCount(item, counts);
  return (
    <Link
      href={item.href}
      aria-label={count > 0 ? `${label}, ${t('shell.unreadCount', { count })}` : label}
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
      {count > 0 ? (
        <RailCount count={count} />
      ) : (
        item.badge === 'new' && (
          <span className="absolute -end-1 -top-1 rounded-full bg-nav-badge px-1 py-0.5 text-[8px] font-bold uppercase leading-none text-nav-badge-foreground">
            {t('shell.new')}
          </span>
        )
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

/** The icon that stands for each menu group on the slim rail (a group not listed here uses its first entry's icon). */
export const GROUP_ICON: Readonly<Record<string, string>> = {
  overview: 'dashboard',
  inbox: 'inbox',
  audience: 'contacts',
  sales: 'crm',
  campaigns: 'campaign',
  automation: 'flow',
  store: 'store',
  apps: 'apps',
};

/** How long the pointer must rest on a group icon before its panel opens, and how long it may be away before the panel closes. */
const FLYOUT_OPEN_MS = 70;
const FLYOUT_CLOSE_MS = 160;

interface FlyoutAnchor {
  top: number;
  edge: number;
}

/**
 * The slim rail: one icon per menu group. Resting the pointer on an icon (or clicking or pressing Enter on it) opens a panel
 * beside the rail with the group's heading and every entry in it, coming-soon ones included, as the labelled panel shows
 * them. A group with a single live screen and nothing planned is a plain link. Escape and a click elsewhere close the panel.
 */
function RailGroups({
  sections,
  activeId,
  show,
  hide,
  rtl,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  show: (el: HTMLElement, label: string) => void;
  hide: () => void;
  rtl: boolean;
}) {
  const t = useTranslations();
  const uid = useId();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<FlyoutAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const panel = useRef<HTMLElement | null>(null);

  const counts = useNavCounts();
  const live = railSections(sections);
  const groups = live.map((s) => {
    const full = sections.find((x) => x.group === s.group);
    return { group: s.group, items: full?.items ?? s.items, liveCount: s.items.length };
  });

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const place = (group: string) => {
    const btn = buttons.current.get(group);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const rail = btn.closest('aside')?.getBoundingClientRect() ?? r;
    setAnchor({
      top: Math.max(8, r.top),
      edge: rtl ? window.innerWidth - rail.left + 6 : rail.right + 6,
    });
    setOpenGroup(group);
    hide();
  };
  const schedule = (fn: () => void, ms: number) => {
    clear();
    timer.current = setTimeout(fn, ms);
  };
  const close = useCallback(() => {
    clear();
    setOpenGroup(null);
  }, [clear]);

  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target)) return;
      if (buttons.current.get(openGroup)?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      buttons.current.get(openGroup)?.focus();
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup, close]);

  const current = groups.find((g) => g.group === openGroup);
  return (
    <nav aria-label={t('shell.mainMenu')} className="flex flex-col items-center gap-1 px-2 py-3">
      {groups.map((g, i) => {
        const single = g.liveCount === 1 && g.items.length === 1;
        const wrap = cn(
          'flex w-full flex-col items-center gap-1',
          i > 0 && 'mt-1 border-t border-nav-border pt-2',
        );
        if (single) {
          const item = g.items[0]!;
          return (
            <div key={g.group} className={wrap}>
              <RailLink item={item} active={item.id === activeId} show={show} hide={hide} />
            </div>
          );
        }
        const label = t(`shell.groups.${g.group}`);
        const active = g.items.some((it) => it.id === activeId);
        const open = openGroup === g.group;
        const waiting = groupCount(g.items, counts);
        const icon = GROUP_ICON[g.group] ?? g.items.find((it) => !it.comingSoon)?.icon;
        return (
          <div key={g.group} className={wrap}>
            <button
              type="button"
              ref={(el) => {
                if (el) buttons.current.set(g.group, el);
                else buttons.current.delete(g.group);
              }}
              aria-label={
                waiting > 0 ? `${label}, ${t('shell.unreadCount', { count: waiting })}` : label
              }
              aria-haspopup="true"
              aria-expanded={open}
              aria-controls={open ? `${uid}-flyout` : undefined}
              onClick={() => (open ? close() : place(g.group))}
              onMouseEnter={() => schedule(() => place(g.group), FLYOUT_OPEN_MS)}
              onMouseLeave={() => schedule(close, FLYOUT_CLOSE_MS)}
              className={cn(
                'relative flex size-11 items-center justify-center rounded-xl outline-none transition',
                'focus-visible:ring-2 focus-visible:ring-nav-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav',
                active || open
                  ? 'bg-nav-active text-nav-active-foreground'
                  : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-active-foreground',
              )}
            >
              <NavIcon name={icon} />
              {waiting > 0 && <RailCount count={waiting} />}
            </button>
          </div>
        );
      })}
      {/* Portalled to <body>: inside the aside the page content would paint over the panel. */}
      {current &&
        anchor &&
        typeof document !== 'undefined' &&
        createPortal(
          <nav
            ref={panel}
            id={`${uid}-flyout`}
            aria-label={t(`shell.groups.${current.group}`)}
            onMouseEnter={clear}
            onMouseLeave={() => schedule(close, FLYOUT_CLOSE_MS)}
            className="fixed z-[90] w-64 overflow-y-auto rounded-xl border border-nav-border bg-nav p-2 text-nav-foreground shadow-2xl"
            style={{
              top: anchor.top,
              maxHeight: `calc(100dvh - ${anchor.top}px - 12px)`,
              ...(rtl ? { right: anchor.edge } : { left: anchor.edge }),
            }}
          >
            <div className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-nav-muted">
              {t(`shell.groups.${current.group}`)}
            </div>
            <ul className="space-y-0.5">
              {current.items.map((item) => (
                <li key={item.id}>
                  <PanelItem item={item} active={item.id === activeId} t={t} onNavigate={close} />
                </li>
              ))}
            </ul>
          </nav>,
          document.body,
        )}
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
            aria-label={t('shell.pinned')}
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
