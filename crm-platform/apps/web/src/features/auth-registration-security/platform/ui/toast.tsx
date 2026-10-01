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
import { cn } from '@crm/ui';
import { CheckIcon, AlertIcon } from './icons';

type Tone = 'success' | 'danger';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<{ push: (tone: Tone, message: string) => void } | null>(null);

const LIFETIME_MS = 6000;

/** A polite live region in the corner. Messages clear themselves; assistive tech hears each one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((all) => all.filter((i) => i.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 sm:bottom-4 sm:w-96"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-2 rounded-md border bg-background px-3 py-2.5 text-sm shadow-lg',
              item.tone === 'success' ? 'border-success/50' : 'border-danger/50',
            )}
          >
            <span
              className={cn('mt-0.5', item.tone === 'success' ? 'text-success' : 'text-danger')}
            >
              {item.tone === 'success' ? <CheckIcon /> : <AlertIcon />}
            </span>
            <span className="min-w-0 flex-1 break-words">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside the operator console shell');
  return {
    success: (message: string) => ctx.push('success', message),
    error: (message: string) => ctx.push('danger', message),
  };
}
