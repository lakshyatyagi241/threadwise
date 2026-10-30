'use client';

import { useEffect } from 'react';

/**
 * The builder is a full-screen layer over the app shell. Reference's builder page has no shell at all, so Tab never leaves the builder;
 * here the sidebar, header and banners sit under the layer, so they are taken out of the page (display none) while it is open: no
 * focus stops, no screen-reader reach, no layout change (the layer is fixed).
 */
export function ShellHidden() {
  useEffect(() => {
    const root = document.querySelector('[data-testid="flow-builder"]');
    const hidden: Array<[HTMLElement, string]> = [];
    let node: Element | null = root;
    while (node && node.parentElement && node.parentElement !== document.body) {
      const parent: Element = node.parentElement;
      for (const sib of Array.from(parent.children)) {
        if (
          sib === node ||
          !(sib instanceof HTMLElement) ||
          sib.className.toString().includes('pointer-events-none')
        )
          continue;
        hidden.push([sib, sib.style.display]);
        sib.style.display = 'none';
      }
      node = parent;
    }
    return () => hidden.forEach(([e, d]) => (e.style.display = d));
  }, []);
  return null;
}
