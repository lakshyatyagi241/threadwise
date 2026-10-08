'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../cn';

const MenuContext = createContext<{ close: () => void } | null>(null);

const ITEM = '[role^="menuitem"]:not([aria-disabled="true"])';

export interface MenuProps {
  /** Accessible name of the menu panel. */
  label: string;
  /** Content of the trigger button. */
  trigger: ReactNode;
  disabled?: boolean;
  /** Which edge of the trigger the panel lines up with (logical, so it flips in RTL). */
  align?: 'start' | 'end';
  /**
   * `fixed`: the panel is positioned against the viewport instead of the trigger's box, so it is not clipped by a scrolling
   * ancestor (a table inside `overflow-x-auto`). It flips above the trigger when there is no room below and closes on scroll or resize.
   */
  placement?: 'anchored' | 'fixed';
  /** Extra classes for the trigger button (it already looks like a secondary button). */
  triggerClassName?: string;
  triggerProps?: Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'onClick' | 'className' | 'disabled' | 'children'
  >;
  className?: string;
  /** The panel's items. A function receives `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  onOpenChange?: (open: boolean) => void;
}

/**
 * A dropdown menu: a button that opens a panel of `MenuItem`, `MenuCheckboxItem` and `MenuRadioItem`.
 * Arrow keys, Home and End move between items, Escape closes and returns focus to the button, Tab and a press
 * outside close it.
 */
export function Menu({
  label,
  trigger,
  disabled,
  align = 'start',
  placement = 'anchored',
  triggerClassName,
  triggerProps,
  className,
  children,
  onOpenChange,
}: MenuProps) {
  const [open, setOpenState] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [fixedAt, setFixedAt] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  } | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPress);
    const onMove = placement === 'fixed' ? close : undefined;
    if (onMove) {
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
    }
    // Focus the checked item, else the first one.
    const first =
      panel.current?.querySelector<HTMLElement>(`${ITEM}[aria-checked="true"]`) ??
      panel.current?.querySelector<HTMLElement>(ITEM);
    first?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPress);
      if (onMove) {
        window.removeEventListener('scroll', onMove, true);
        window.removeEventListener('resize', onMove);
      }
    };
  }, [open, close, placement, align]);

  /** Where the `fixed` panel goes, measured from the trigger just before it opens (never in an effect). */
  const measure = () => {
    if (placement !== 'fixed' || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const endEdge = (align === 'end') !== (getComputedStyle(button.current).direction === 'rtl');
    setFixedAt({
      ...(below < 260 && r.top > below
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
      ...(endEdge ? { right: window.innerWidth - r.right } : { left: r.left }),
    });
  };

  const onPanelKey = (e: ReactKeyboardEvent) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? items.length - 1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      button.current?.focus();
    } else if (e.key === 'Tab') close();
  };

  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) measure();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            measure();
            setOpen(true);
          }
        }}
        className={cn(
          'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
        {...triggerProps}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKey}
          style={placement === 'fixed' ? (fixedAt ?? { visibility: 'hidden' }) : undefined}
          className={cn(
            'z-40 max-h-[min(28rem,70vh)] w-max max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border bg-background p-1 text-start shadow-lg',
            placement === 'fixed'
              ? 'fixed min-w-48'
              : cn('absolute top-full mt-1 min-w-full', align === 'end' ? 'end-0' : 'start-0'),
            className,
          )}
        >
          <MenuContext.Provider value={{ close }}>
            {typeof children === 'function' ? children(close) : children}
          </MenuContext.Provider>
        </div>
      )}
    </div>
  );
}

const itemBase =
  'flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm outline-none transition ' +
  'hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

interface ItemProps {
  children: ReactNode;
  disabled?: boolean;
  /** Text at the trailing edge (a count). */
  hint?: ReactNode;
  className?: string;
}

export function MenuItem({
  children,
  disabled,
  hint,
  danger,
  keepOpen,
  onSelect,
  className,
}: ItemProps & { danger?: boolean; keepOpen?: boolean; onSelect: () => void }) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (disabled) return;
        if (!keepOpen) ctx?.close();
        onSelect();
      }}
      className={cn(itemBase, danger && 'text-danger', className)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn('size-3.5 shrink-0', !on && 'invisible')}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

/** A single choice out of several; picking it closes the menu. */
export function MenuRadioItem({
  checked,
  onSelect,
  children,
  disabled,
  hint,
  className,
}: ItemProps & { checked: boolean; onSelect: () => void }) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (disabled) return;
        ctx?.close();
        onSelect();
      }}
      className={cn(itemBase, checked && 'font-medium', className)}
    >
      <Check on={checked} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

/** An on/off option; toggling keeps the menu open so several can be changed in one visit. */
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  disabled,
  hint,
  className,
}: ItemProps & { checked: boolean; onCheckedChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      className={cn(itemBase, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border',
          checked ? 'border-brand bg-brand text-brand-foreground' : 'border-border',
        )}
      >
        <Check on={checked} />
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div
      role="presentation"
      className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}
