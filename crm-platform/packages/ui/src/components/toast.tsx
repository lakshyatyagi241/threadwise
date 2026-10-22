'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../cn';

export type ToastTone = 'success' | 'danger' | 'info';

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
}

interface ToastApi {
  /**
   * Shows a message; success and info fade after 5 s, errors stay 9 s (`durationMs` changes that: an "Undo" stays longer).
   * Returns an id for `dismiss`.
   */
  toast: (message: ReactNode, tone?: ToastTone, opts?: { durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LIFETIME_MS: Record<ToastTone, number> = { success: 5000, info: 5000, danger: 9000 };

/** Each tone: the accent edge of the card and the tint of its icon. */
const TONES: Record<ToastTone, { edge: string; badge: string }> = {
  success: { edge: 'border-s-success', badge: 'bg-success/15 text-success' },
  info: { edge: 'border-s-primary', badge: 'bg-primary/15 text-primary' },
  danger: { edge: 'border-s-danger', badge: 'bg-danger/15 text-danger' },
};

const ICONS: Record<ToastTone, string[]> = {
  success: ['M5 12.5l4.5 4.5L19 7.5'],
  info: ['M12 11v5', 'M12 7.5h.01'],
  danger: ['M12 7v6', 'M12 16.5h.01'],
};

/** Hosts the toast region. Wrap the screens that raise toasts once; `useToast()` works anywhere below. */
export function ToastProvider({
  children,
  dismissLabel = 'Dismiss',
  placement = 'bottom',
}: {
  children: ReactNode;
  dismissLabel?: string;
  /** Where the messages stack: the bottom corner (the default) or just under the page's top bar, beside its buttons. */
  placement?: 'bottom' | 'top';
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, tone: ToastTone = 'success', opts?: { durationMs?: number }) => {
      const id = ++seq.current;
      setItems((cur) => [...cur.slice(-3), { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), opts?.durationMs ?? LIFETIME_MS[tone]),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live.values()) clearTimeout(t);
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed inset-x-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end',
          placement === 'top' ? 'top-16' : 'bottom-4',
        )}
      >
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'crm-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-s-4 border-border bg-background py-2.5 ps-3 pe-2 text-sm shadow-lg',
              TONES[i.tone].edge,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-px flex size-6 shrink-0 items-center justify-center rounded-full',
                TONES[i.tone].badge,
              )}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[i.tone].map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </span>
            <span className="min-w-0 flex-1 break-words py-0.5 font-medium leading-snug text-foreground">
              {i.message}
            </span>
            <button
              type="button"
              onClick={() => dismiss(i.id)}
              aria-label={dismissLabel}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
