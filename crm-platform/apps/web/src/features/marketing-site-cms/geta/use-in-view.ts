'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * True while the element is in the middle half of the window. It is the band the visitor is actually looking at, so a tall
 * element (a walkthrough on a phone) still counts, and an animation that waits for this starts when it is seen, not when
 * the page loads.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), {
      rootMargin: '-25% 0px -25% 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}
