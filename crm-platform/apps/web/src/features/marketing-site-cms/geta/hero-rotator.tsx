'use client';

import { useEffect, useState } from 'react';

/** Fired by the hero artwork whenever it moves to another industry, so the headline names the same one. */
export const NICHE_EVENT = 'gx:niche';

/**
 * The end of the home headline ("... built around your clinic"). The first phrase is in the server HTML so the headline
 * reads in full without JavaScript; after mount it follows the industry the artwork below is showing.
 */
export function HeroRotator({ phrases }: { phrases: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<number>).detail;
      if (typeof next === 'number' && next >= 0 && next < phrases.length) setI(next);
    };
    window.addEventListener(NICHE_EVENT, on);
    return () => window.removeEventListener(NICHE_EVENT, on);
  }, [phrases.length]);
  return (
    <span className="gx-rotator">
      <span key={i} className="gx-rotator-phrase gx-grad-text">
        {phrases[i]}
      </span>
    </span>
  );
}
