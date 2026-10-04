'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import { NavIcon } from '@/components/shell/nav-icons';
import { useStoredValue } from '@/lib/use-stored-value';
import { useQuickAccess } from './api';
import { HANDLE_DEFAULT_TOP, HANDLE_KEY, clampHandleTop } from './logic';
import { QuickAccessModal } from './quick-access-modal';

const NS = 'admin-console-shell.quickAccess';

/**
 * The edge drawer (WD-ASHELL-022): a grip on the right edge you can drag up and down (its place is remembered), which slides
 * out the pinned shortcuts with Dashboard, "All apps" and "Edit shortcuts". Escape closes it.
 */
export function QuickAccessDrawer() {
  const t = useTranslations(NS);
  const q = useQuickAccess();
  const [stored, setStored] = useStoredValue(HANDLE_KEY);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragTop, setDragTop] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null);

  const saved = stored === null ? HANDLE_DEFAULT_TOP : Number(stored);
  const top =
    dragTop ?? clampHandleTop(saved, typeof window === 'undefined' ? 800 : window.innerHeight);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startTop: top, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragTop(clampHandleTop(d.startTop + dy, window.innerHeight));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      if (dragTop !== null) setStored(String(Math.round(dragTop)));
      setDragTop(null);
    } else {
      setOpen((v) => !v);
    }
  };

  const tiles = q.data?.tiles ?? [];
  return (
    <>
      <button
        type="button"
        aria-label={t('open')}
        aria-expanded={open}
        title={t('open')}
        style={{ top }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="fixed end-0 z-40 flex h-12 w-5 cursor-grab touch-none items-center justify-center rounded-s-lg border border-e-0 border-border bg-background text-muted-foreground shadow-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden="true" className="h-6 w-1 rounded-full bg-border" />
      </button>
      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <aside
            role="dialog"
            aria-label={t('title')}
            className="fixed inset-y-0 end-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-s border-border bg-background p-3 shadow-xl"
          >
            <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('title')}
            </h2>
            {tiles.map((tile) => (
              <DrawerLink
                key={`${tile.key ?? tile.url}`}
                href={tile.url}
                icon={tile.icon}
                title={tile.desc}
                onNavigate={() => setOpen(false)}
              >
                {tile.custom ? tile.label : t(`catalog.${tile.key}.label`)}
              </DrawerLink>
            ))}
            <div className="my-2 h-px bg-border" />
            <DrawerLink href="/dashboard" icon="dashboard" onNavigate={() => setOpen(false)}>
              {t('dashboard')}
            </DrawerLink>
            <DrawerLink href="/more" icon="grid" onNavigate={() => setOpen(false)}>
              {t('allApps')}
            </DrawerLink>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(true);
              }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              <NavIcon name="gear" className="size-4" />
              {t('edit')}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-auto rounded-md px-3 py-2 text-start text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('close')}
            </button>
          </aside>
        </>
      )}
      <QuickAccessModal open={editing} tiles={tiles} onClose={() => setEditing(false)} />
    </>
  );
}

function DrawerLink({
  href,
  icon,
  title,
  onNavigate,
  children,
}: {
  href: string;
  icon: string;
  title?: string;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  const external = /^https?:\/\//i.test(href);
  const cls = cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
  );
  const inner = (
    <>
      <NavIcon name={icon} className="size-4" />
      <span className="truncate">{children}</span>
    </>
  );
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cls}
      onClick={onNavigate}
    >
      {inner}
    </a>
  ) : (
    <Link href={href} title={title} className={cls} onClick={onNavigate}>
      {inner}
    </Link>
  );
}
