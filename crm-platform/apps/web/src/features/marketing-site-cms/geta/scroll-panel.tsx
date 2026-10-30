'use client';

import { useEffect } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * Fades the navy "Why one platform" section in and out with the scroll. It sets `--k` on the section: 1 while the section is
 * entering or leaving and 0 through the middle. The CSS turns that number into the section's opacity.
 */
export function ScrollPanel({ label }: { label: string }) {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
    if (!el || window.matchMedia(REDUCED).matches) return;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (r.height + vh)));
      const k = p < 0.22 ? 1 - p / 0.22 : p > 0.78 ? (p - 0.78) / 0.22 : 0;
      el.style.setProperty('--k', ease(Math.min(1, Math.max(0, k))).toFixed(3));
    };
    // a few multiplications per scroll event: no need to batch with requestAnimationFrame
    const onScroll = update;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      el.style.removeProperty('--k');
    };
  }, [label]);
  return null;
}
