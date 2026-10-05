import { readStorage, writeStorage } from './cart';

/**
 * A tiny store over localStorage for the cart, wishlist and compare list. When storage is blocked the values still live in memory
 * for the page, so the shop works without it. Reads are strings (or null), which keeps `useSyncExternalStore` snapshots stable
 * and makes the server render and the first client render agree (both see null).
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key) memory.delete(e.key);
    notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function readPersisted(key: string): string | null {
  return memory.get(key) ?? readStorage(key);
}

export function writePersisted(key: string, value: string): void {
  memory.set(key, value);
  writeStorage(key, value);
  notify();
}
