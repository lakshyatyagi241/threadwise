import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Focus for a modal sheet (`role="dialog"` with `aria-modal`). On mount, focus moves into the sheet and the page behind it is made
 * inert: every sibling of the sheet's ancestors that is not fixed-position, including nodes added while the sheet is open. Fixed layers
 * (toasts, banners) stay usable above it. Tab wraps inside the sheet. On unmount the page is live again and focus returns to the control
 * that had it.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement;
    const behind = new Set<Element>();
    const sweep = () => {
      for (
        let node: HTMLElement | null = dialog;
        node && node !== document.body;
        node = node.parentElement
      ) {
        for (const sibling of Array.from(node.parentElement?.children ?? [])) {
          if (
            sibling === node ||
            sibling.hasAttribute('inert') ||
            getComputedStyle(sibling).position === 'fixed'
          ) {
            continue;
          }
          sibling.setAttribute('inert', '');
          behind.add(sibling);
        }
      }
    };
    // Tab wraps inside the sheet, so focus never leaves it for the browser's own controls while it is open.
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    sweep();
    const observer = new MutationObserver(sweep);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onTab);
    dialog.focus();
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onTab);
      for (const el of behind) el.removeAttribute('inert');
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [ref]);
}
