'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { MAX_TABS } from './console-layout';
import {
  activeStatusBadgeInfo,
  formatCount,
  type ConsoleGroup,
  type ConsoleLeaf,
} from './console-nav';
import type { ConsoleCounts } from './console-counts';

const tabClass = (active: boolean) =>
  cn(
    'inline-flex min-h-9 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm font-medium transition',
    'focus-visible:ring-2 focus-visible:ring-primary',
    active
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
  );

/**
 * The tab bar of a hub (docs/specs/admin-menu-hubs.md). Every tab is a link to the page's own address, so bookmarks, permissions
 * and each page's own code are untouched; the shell draws this above whatever page is open. The first `MAX_TABS` pages sit in
 * the bar, the rest (module pages added at run time) under "More". A Settings-style `index` hub has no bar: its pages show a back
 * link to the hub's landing page, which lists them all.
 */
export function HubTabs({
  hub,
  activeId,
  counts,
}: {
  hub: ConsoleGroup;
  activeId: string | null;
  counts: ConsoleCounts;
}) {
  const t = useTranslations();
  const tc = useTranslations('admin-console-shell.shell');
  const label = t(hub.labelKey);

  if (hub.kind === 'index') {
    const landing = hub.children[0];
    if (!landing || landing.id === activeId) return null;
    return (
      <nav aria-label={label} className="mb-4 text-sm">
        <Link
          href={landing.href}
          data-testid="hub-back"
          className="inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true" className="rtl:-scale-x-100">
            ←
          </span>
          {tc('backToHub', { hub: label })}
        </Link>
      </nav>
    );
  }

  if (hub.children.length < 2) return null;
  const inBar = hub.children.slice(0, MAX_TABS);
  const more = hub.children.slice(MAX_TABS);
  const moreActive = more.some((leaf) => leaf.id === activeId);

  const tab = (leaf: ConsoleLeaf) => {
    const active = leaf.id === activeId;
    const count = formatCount(leaf.badgeKey ? counts[leaf.badgeKey] : null);
    const status = activeStatusBadgeInfo(leaf, counts);
    return (
      <Link
        key={leaf.id}
        href={leaf.href}
        data-testid={`tab-${leaf.id}`}
        aria-current={active ? 'page' : undefined}
        className={tabClass(active)}
      >
        <span>{leaf.label ?? t(leaf.labelKey)}</span>
        {count && (
          <span
            data-testid={`count-${leaf.id}`}
            className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
          >
            {count}
          </span>
        )}
        {status && (
          <span
            data-testid={`status-${leaf.id}`}
            data-tone={status.tone}
            className={cn(
              'rounded-full px-1.5 text-[0.6875rem] font-medium leading-4',
              status.tone === 'warning' ? 'bg-warning/25' : 'bg-muted text-muted-foreground',
            )}
          >
            {t(status.labelKey)}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="-mx-4 mb-4 flex items-end gap-1 border-b border-border px-4 md:-mx-6 md:px-6">
      <TabScroller label={label} activeId={activeId}>
        {inBar.map(tab)}
      </TabScroller>
      {more.length > 0 && (
        <MoreMenu
          active={moreActive}
          activeId={activeId}
          label={tc('moreTabs')}
          items={more.map((leaf) => ({
            id: leaf.id,
            href: leaf.href,
            text: leaf.label ?? t(leaf.labelKey),
          }))}
        />
      )}
    </div>
  );
}

/** The scrolling row of tabs; the open tab is brought into view (a narrow screen shows only a few of them). */
function TabScroller({
  label,
  activeId,
  children,
}: {
  label: string;
  activeId: string | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  return (
    <nav
      ref={ref}
      aria-label={label}
      data-testid="hub-tabs"
      className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
    >
      {children}
    </nav>
  );
}

/**
 * The tabs that did not fit (module pages added at run time). Outside the scrolling row, so the list is not clipped by it; it closes
 * on a pick, on Escape, on a click elsewhere and whenever another page opens.
 */
function MoreMenu({
  active,
  activeId,
  label,
  items,
}: {
  active: boolean;
  activeId: string | null;
  label: string;
  items: ReadonlyArray<{ id: string; href: string; text: string }>;
}) {
  // Opening another page closes the menu: the open state remembers which page it was opened on.
  const [openOn, setOpenOn] = useState<string | null | false>(false);
  const open = openOn === activeId;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) =>
    setOpenOn((cur) => ((typeof v === 'function' ? v(cur === activeId) : v) ? activeId : false));
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(false);
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpenOn(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className={cn(tabClass(active), 'cursor-pointer')}
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute end-0 top-full z-20 mt-1 flex min-w-48 flex-col rounded-md border border-border bg-background p-1 shadow-lg">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              aria-current={item.id === activeId ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                item.id === activeId && 'bg-muted font-medium',
              )}
            >
              {item.text}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
