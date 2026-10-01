'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import { dirOf } from '@/i18n/locales';
import type { ResolvedNavItem } from '@/features/_registry/types';
import { ChevronIcon, CloseIcon, NavIcon } from './nav-icons';
import { railSections, type NavSection } from './nav-model';

type Translate = ReturnType<typeof useTranslations>;

function Pill({ tone, children }: { tone: 'new' | 'soon' | 'upgrade'; children: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
        tone === 'new' && 'bg-warning text-white',
        tone === 'soon' && 'bg-muted text-muted-foreground',
        tone === 'upgrade' && 'bg-warning/15 text-warning',
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
  const row = 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm';
  if (item.comingSoon) {
    return (
      <span
        aria-disabled="true"
        title={t('shell.comingSoon')}
        className={cn(row, 'cursor-not-allowed text-muted-foreground/70')}
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
        'outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
        active
          ? 'bg-brand font-medium text-brand-foreground'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {body}
    </Link>
  );
}

/** Every group with its heading, coming-soon entries included. Used by the pinned panel and the mobile drawer. */
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
  return (
    <nav aria-label={t('shell.mainMenu')} className="space-y-5 px-3 py-4">
      {sections.map((section) => (
        <div key={section.group}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
      ))}
    </nav>
  );
}

interface Tip {
  label: string;
  top: number;
  edge: number;
}

/**
 * The slim icon rail: one icon per real screen, a "Quick links" caption, a dark-green block on the active entry and a
 * tooltip with the label. A button at the bottom pins open the labelled panel (remembered per browser).
 */
export function NavRail({
  sections,
  activeId,
  pinned,
  onTogglePinned,
}: {
  sections: readonly NavSection[];
  activeId: string | undefined;
  pinned: boolean;
  onTogglePinned: () => void;
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
  return (
    <aside
      className={cn(
        'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col border-e border-border bg-background md:flex',
        'transition-[width] duration-200 motion-reduce:transition-none',
        pinned ? 'w-64' : 'w-[4.5rem]',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {pinned ? (
          <NavPanel sections={sections} activeId={activeId} />
        ) : (
          <RailIcons
            sections={railSections(sections)}
            activeId={activeId}
            show={show}
            hide={() => setTip(null)}
          />
        )}
      </div>
      <div className={cn('border-t border-border p-3', !pinned && 'flex justify-center')}>
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
            'flex items-center gap-3 rounded-lg text-sm text-muted-foreground outline-none transition',
            'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary',
            pinned ? 'w-full px-3 py-2' : 'size-11 justify-center',
          )}
        >
          <ChevronIcon
            dir={pinned === rtl ? 'right' : 'left'}
            className="size-[18px]"
          />
          {pinned && <span>{t('shell.collapseMenu')}</span>}
        </button>
      </div>
      {tip && (
        <div
          role="presentation"
          aria-hidden="true"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg"
          style={{ top: tip.top, ...(rtl ? { right: tip.edge } : { left: tip.edge }) }}
        >
          {tip.label}
        </div>
      )}
    </aside>
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
      <div
        aria-hidden="true"
        className="w-full px-0.5 pb-2 text-center text-[9px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground"
      >
        {t('shell.quickLinks')}
      </div>
      {sections.map((section, i) => (
        <div
          key={section.group}
          role="group"
          aria-label={t(`shell.groups.${section.group}`)}
          className={cn('flex w-full flex-col items-center gap-1', i > 0 && 'mt-1 border-t border-border pt-2')}
        >
          {section.items.map((item) => {
            const label = t(item.labelKey);
            const active = item.id === activeId;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onMouseEnter={(e) => show(e.currentTarget, label)}
                onMouseLeave={hide}
                onFocus={(e) => show(e.currentTarget, label)}
                onBlur={hide}
                className={cn(
                  'relative flex size-11 items-center justify-center rounded-xl outline-none transition',
                  'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active
                    ? 'bg-brand text-brand-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <NavIcon name={item.icon} />
                {item.badge === 'new' && (
                  <span className="absolute -end-1 -top-1 rounded-full bg-warning px-1 py-0.5 text-[8px] font-bold uppercase leading-none text-white">
                    {t('shell.new')}
                  </span>
                )}
                {item.locked && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 end-1 size-2 rounded-full bg-warning ring-2 ring-background"
                  />
                )}
              </Link>
            );
          })}
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
}: {
  open: boolean;
  onClose: () => void;
  sections: readonly NavSection[];
  activeId: string | undefined;
  returnFocusTo: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations();
  const closeRef = useRef<HTMLButtonElement>(null);

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
        className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="font-semibold">{t('common.appName')}</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('shell.closeMenu')}
            className="flex size-9 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavPanel sections={sections} activeId={activeId} onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
