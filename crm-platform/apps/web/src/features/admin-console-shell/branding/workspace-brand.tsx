'use client';

import { useEffect } from 'react';
import type { WorkspaceBrand } from '@crm/contracts';
import { brandCss } from './brand-css';

/**
 * Applies the workspace's white-label colours and favicon in the customer shell (TW-ASHELL-025). The favicon is applied here,
 * which Reference never did (its stored favicon had no effect). The page's own icon comes back when the brand is cleared.
 */
export function WorkspaceBrandStyle({ brand }: { brand: WorkspaceBrand | null | undefined }) {
  const css = brandCss(brand ?? null);
  const favicon = brand?.faviconUrl ?? null;
  useEffect(() => {
    if (!favicon) return;
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    const saved = links.map((l) => [l, l.href] as const);
    links.forEach((l) => (l.href = favicon));
    if (links.length === 0) {
      const l = document.createElement('link');
      l.rel = 'icon';
      l.href = favicon;
      l.dataset.workspaceBrand = '1';
      document.head.appendChild(l);
      return () => l.remove();
    }
    return () => saved.forEach(([l, href]) => (l.href = href));
  }, [favicon]);
  return css ? <style data-workspace-brand dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
