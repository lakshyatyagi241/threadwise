'use client';

import type { PublicProduct, PublicShop } from '@crm/contracts';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  addOne,
  addQty,
  cartCount,
  cartSubtotal,
  parseStoredCart,
  parseStoredIds,
  removeLine,
  setQty,
  storageKeys,
  type Cap,
  type CartLine,
  type Shipping,
} from '../lib/cart';
import { mergeProducts } from '../lib/catalog';
import { readPersisted, subscribe, writePersisted } from '../lib/persist';
import { resolveTheme, type ResolvedTheme } from '../lib/themes';

export const MAX_COMPARE = 4;

export type ModalSpec =
  | { kind: 'message'; title: string; body: string }
  | { kind: 'quick'; productId: string }
  | { kind: 'share'; url: string; title: string }
  | { kind: 'checkout' }
  | {
      kind: 'placed';
      message: string;
      trackUrl: string | null;
      orderNo: number;
      waUrl: string | null;
    }
  | { kind: 'info'; topic: 'shipping' | 'returns' | 'howToOrder' | 'privacy' };

export type DrawerKind = 'cart' | 'wish' | 'compare';
type BadgeKind = DrawerKind;

export interface StoreApi {
  shop: PublicShop;
  theme: ResolvedTheme;
  shipping: Shipping;
  catalog: Readonly<Record<string, PublicProduct>>;
  /** Makes products known to the cart, quick view, wishlist and compare (the home page registers every "Show more" page). */
  register: (products: readonly PublicProduct[]) => void;
  cart: readonly CartLine[];
  cartCount: number;
  cartSubtotal: number;
  wish: readonly string[];
  compare: readonly string[];
  bumps: Readonly<Record<BadgeKind, number>>;
  addToCart: (product: PublicProduct) => void;
  addQuantity: (product: PublicProduct, qty: number) => void;
  /** Returns the quantity the line really has afterwards (clamped to the stock cap, at least 1). */
  setLineQty: (id: string, qty: number) => number;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  toggleWish: (id: string) => void;
  toggleCompare: (id: string) => void;
  drawer: DrawerKind | null;
  toggleDrawer: (kind: DrawerKind) => void;
  closeDrawer: () => void;
  modal: ModalSpec | null;
  openModal: (spec: ModalSpec) => void;
  closeModal: () => void;
  openCheckout: () => void;
  openQuickView: (product: PublicProduct) => void;
  openShare: (url: string, title: string) => void;
  flash: (message: string) => void;
  toastMessage: string | null;
  search: string;
  setSearch: (term: string) => void;
}

const Ctx = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>');
  return v;
}

const TOAST_MS = 1800;

export function StoreProvider({
  shop,
  products,
  children,
}: {
  shop: PublicShop;
  products: readonly PublicProduct[];
  children: ReactNode;
}) {
  const t = useTranslations('shopPublic');
  const keys = useMemo(() => storageKeys(shop.slug), [shop.slug]);
  const theme = useMemo(
    () => resolveTheme(shop.themeKey, shop.brandColor),
    [shop.themeKey, shop.brandColor],
  );
  const shipping = shop.shipping;

  const [catalog, setCatalog] = useState<Record<string, PublicProduct>>(() =>
    Object.fromEntries(products.map((p) => [p.id, p])),
  );
  const register = useCallback((incoming: readonly PublicProduct[]) => {
    setCatalog((c) => {
      const fresh = mergeProducts(Object.values(c), incoming);
      return fresh.length === Object.keys(c).length
        ? c
        : Object.fromEntries(fresh.map((p) => [p.id, p]));
    });
  }, []);

  const rawCart = useSyncExternalStore(
    subscribe,
    () => readPersisted(keys.cart),
    () => null,
  );
  const rawWish = useSyncExternalStore(
    subscribe,
    () => readPersisted(keys.wish),
    () => null,
  );
  const rawCompare = useSyncExternalStore(
    subscribe,
    () => readPersisted(keys.compare),
    () => null,
  );
  const cart = useMemo(() => parseStoredCart(rawCart), [rawCart]);
  const wish = useMemo(() => parseStoredIds(rawWish), [rawWish]);
  const compare = useMemo(() => parseStoredIds(rawCompare, MAX_COMPARE), [rawCompare]);

  const [bumps, setBumps] = useState<Record<BadgeKind, number>>({ cart: 0, wish: 0, compare: 0 });
  const bump = useCallback((k: BadgeKind) => setBumps((b) => ({ ...b, [k]: b[k] + 1 })), []);

  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const flash = useCallback(
    (message: string) => setToast((cur) => ({ id: (cur?.id ?? 0) + 1, message })),
    [],
  );
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastId]);

  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [search, setSearch] = useState('');
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const closeModal = useCallback(() => setModal(null), []);
  const toggleDrawer = useCallback(
    (k: DrawerKind) => setDrawer((cur) => (cur === k ? null : k)),
    [],
  );
  const openModal = useCallback((spec: ModalSpec) => setModal(spec), []);

  const readCart = useCallback(() => parseStoredCart(readPersisted(keys.cart)), [keys.cart]);
  const writeCart = useCallback(
    (next: readonly CartLine[]) => writePersisted(keys.cart, JSON.stringify(next)),
    [keys.cart],
  );

  const stockMessage = useCallback(
    (cap: Cap): { title: string; body: string } =>
      cap.reason === 'max'
        ? {
            title: t('stock.maxTitle', { count: cap.cap }),
            body: t('stock.maxBody', { count: cap.cap }),
          }
        : {
            title: t('stock.title', { count: cap.cap }),
            body: cap.cap === 0 ? t('stock.soldOut') : t('stock.limit', { count: cap.cap }),
          },
    [t],
  );

  const addToCart = useCallback(
    (product: PublicProduct) => {
      const out = addOne(readCart(), product);
      if (out.kind === 'capped') {
        setModal({ kind: 'message', ...stockMessage(out.cap) });
        return;
      }
      if (out.kind === 'full') {
        setModal({ kind: 'message', title: t('cart.fullTitle'), body: t('cart.fullBody') });
        return;
      }
      writeCart(out.cart);
      bump('cart');
      flash(t('toast.added', { name: product.name }));
    },
    [readCart, writeCart, stockMessage, bump, flash, t],
  );

  const addQuantity = useCallback(
    (product: PublicProduct, qty: number) => {
      const out = addQty(readCart(), product, qty);
      if (out.full) {
        setModal({ kind: 'message', title: t('cart.fullTitle'), body: t('cart.fullBody') });
        return;
      }
      if (out.clamped) flash(stockMessage(out.clamped).title);
      writeCart(out.cart);
      bump('cart');
    },
    [readCart, writeCart, stockMessage, bump, flash, t],
  );

  const setLineQty = useCallback(
    (id: string, qty: number) => {
      const out = setQty(readCart(), id, qty, catalog[id]);
      if (out.clamped) flash(stockMessage(out.clamped).title);
      writeCart(out.cart);
      return out.cart.find((l) => l.id === id)?.qty ?? 0;
    },
    [readCart, writeCart, catalog, stockMessage, flash],
  );

  const removeFromCart = useCallback(
    (id: string) => writeCart(removeLine(readCart(), id)),
    [readCart, writeCart],
  );
  const clearCart = useCallback(() => writeCart([]), [writeCart]);

  const toggleWish = useCallback(
    (id: string) => {
      const current = parseStoredIds(readPersisted(keys.wish));
      if (current.includes(id)) {
        writePersisted(keys.wish, JSON.stringify(current.filter((x) => x !== id)));
        flash(t('toast.wishRemoved'));
      } else {
        writePersisted(keys.wish, JSON.stringify([...current, id]));
        bump('wish');
        flash(t('toast.wishAdded'));
      }
    },
    [keys.wish, bump, flash, t],
  );

  const toggleCompare = useCallback(
    (id: string) => {
      const current = parseStoredIds(readPersisted(keys.compare), MAX_COMPARE);
      if (current.includes(id)) {
        writePersisted(keys.compare, JSON.stringify(current.filter((x) => x !== id)));
        flash(t('toast.compareRemoved'));
      } else if (current.length >= MAX_COMPARE) {
        setModal({
          kind: 'message',
          title: t('compare.fullTitle'),
          body: t('compare.fullBody', { count: MAX_COMPARE }),
        });
      } else {
        writePersisted(keys.compare, JSON.stringify([...current, id]));
        bump('compare');
        flash(t('toast.compareAdded'));
      }
    },
    [keys.compare, bump, flash, t],
  );

  // As in Reference, the cart drawer stays open behind the checkout dialog.
  const openCheckout = useCallback(() => {
    if (readCart().length === 0) {
      setModal({ kind: 'message', title: t('checkout.emptyTitle'), body: t('checkout.emptyBody') });
    } else {
      setModal({ kind: 'checkout' });
    }
  }, [readCart, t]);

  const openQuickView = useCallback((product: PublicProduct) => {
    setCatalog((c) => (c[product.id] ? c : { ...c, [product.id]: product }));
    setModal({ kind: 'quick', productId: product.id });
  }, []);
  const openShare = useCallback(
    (url: string, title: string) => setModal({ kind: 'share', url, title }),
    [],
  );

  const value: StoreApi = {
    shop,
    theme,
    shipping,
    catalog,
    register,
    cart,
    cartCount: cartCount(cart),
    cartSubtotal: cartSubtotal(cart),
    wish,
    compare,
    bumps,
    addToCart,
    addQuantity,
    setLineQty,
    removeFromCart,
    clearCart,
    toggleWish,
    toggleCompare,
    drawer,
    toggleDrawer,
    closeDrawer,
    modal,
    openModal,
    closeModal,
    openCheckout,
    openQuickView,
    openShare,
    flash,
    toastMessage: toast?.message ?? null,
    search,
    setSearch,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
