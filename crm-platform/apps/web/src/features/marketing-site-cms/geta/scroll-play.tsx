'use client';

import { useEffect } from 'react';

/** What fades and rises into place when its section comes into view. Siblings follow one another a beat apart. */
const REVEAL =
  '.gx-sec-head, .gx-grid > *, .gx-split > *, .gx-layers > *, .gx-layerlist li, .bt-c, .tr-card, .pc, .gx-faq details, .np, .ot-vis, .ot-copy, .vx, .md, .cp, .gx-band, .gx-statcard, .ls, .tr-logos, .tr-badges';

/**
 * Brings the page to life as it is scrolled:
 * - every section holds its looping and entrance animations until it is on screen, and pauses them when it leaves, so
 *   nothing plays out of sight and each section starts when the visitor reaches it;
 * - the cards, headings and panels inside a section fade and rise into place one after another;
 * - the header gets a soft shadow once the page has moved.
 * Visitors who prefer reduced motion are left alone, and without this script nothing is held or hidden.
 */
export function ScrollPlay() {
  useEffect(() => {
    const root = document.querySelector('.gx-site');
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sections = [...root.querySelectorAll('section.gx-sec')];

    const marked: HTMLElement[] = [];
    for (const s of sections) {
      const seen = new Map<Element, number>();
      s.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        // a nested match (a card inside a grid inside a head) reveals with its outermost parent only
        if (el.parentElement?.closest('[data-rv]')) return;
        const parent = el.parentElement!;
        const n = seen.get(parent) ?? 0;
        seen.set(parent, n + 1);
        el.dataset.rv = '';
        el.style.setProperty('--rv', String(Math.min(n, 6)));
        marked.push(el);
      });
    }

    root.classList.add('gx-sp');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.classList.toggle('in-view', e.isIntersecting);
      },
      { rootMargin: '-8% 0px -8% 0px' },
    );
    sections.forEach((s) => io.observe(s));

    const header = root.querySelector('.gx-header');
    const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      root.classList.remove('gx-sp');
      sections.forEach((s) => s.classList.remove('in-view'));
      marked.forEach((el) => {
        delete el.dataset.rv;
        el.style.removeProperty('--rv');
      });
    };
  }, []);
  return null;
}
