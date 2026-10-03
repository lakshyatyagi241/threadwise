'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Elements with `.reveal` fade and slide in once they enter the viewport (WaDesk's inline observer). Without
 * IntersectionObserver, or in the editor preview, everything is shown at once.
 */
export function RevealObserver({ all = false }: { all?: boolean }) {
  const path = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.cms-site .reveal'));
    if (all || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.1 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [all, path]);
  return null;
}
