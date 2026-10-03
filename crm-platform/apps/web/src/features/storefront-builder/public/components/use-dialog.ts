'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );

/**
 * Behaviour of a drawer or modal while it is open: focus moves inside, Tab stays inside, Escape closes, the page behind does not
 * scroll, and focus returns to what opened it.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusables(root)[0];
    (first ?? root).focus({ preventScroll: true });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === head || !root.contains(active))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (active === tail || !root.contains(active))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref, open, onClose]);
}
