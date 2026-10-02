'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MenuItem, MenuSeparator, cn } from '@crm/ui';
import { MoreIcon } from './icons';

const PANEL_W = 208;

/**
 * The "..." menu of a table row. The panel is drawn in a portal at the page level and positioned from the button, so
 * the table's own scrolling and its frozen cells can neither clip it nor paint over it. Escape, a press outside,
 * scrolling and resizing close it; arrow keys move between items.
 */
export function RowMenu({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  /** Items; a function receives `close`. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 240;
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - PANEL_W - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = () => [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
    items()[0]?.focus();
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        list[(at + 1) % list.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        list[(at <= 0 ? list.length : at) - 1]?.focus();
      } else if (e.key === 'Tab') setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary',
          open && 'bg-muted text-foreground',
          className,
        )}
      >
        <MoreIcon className="size-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_W }}
            className="fixed z-[60] rounded-md border border-border bg-background p-1 text-start shadow-lg"
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export { MenuItem as RowMenuItem, MenuSeparator as RowMenuSeparator };
