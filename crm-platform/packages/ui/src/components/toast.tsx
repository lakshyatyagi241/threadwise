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

const TONES: Record<ToastTone, string> = {
  success: 'border-success/40 text-success',
  info: 'border-border text-foreground',
  danger: 'border-danger/40 text-danger',
};

/** Hosts the toast region. Wrap the screens that raise toasts once; `useToast()` works anywhere below. */
export function ToastProvider({
  children,
  dismissLabel = 'Dismiss',
}: {
  children: ReactNode;
  dismissLabel?: string;
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
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:end-4 sm:items-end"
      >
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border bg-background px-4 py-2.5 text-sm shadow-lg',
              TONES[i.tone],
            )}
          >
            <span className="min-w-0 flex-1">{i.message}</span>
            <button
              type="button"
              onClick={() => dismiss(i.id)}
              aria-label={dismissLabel}
              className="-me-1 shrink-0 rounded text-muted-foreground hover:text-foreground"
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
