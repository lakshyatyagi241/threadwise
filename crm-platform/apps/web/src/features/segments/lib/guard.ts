/**
 * Pure parts of the unsaved-changes guard: which clicks count as leaving the page. The hook that wires them to the
 * browser is `components/use-unsaved-guard.ts`.
 */

export interface ClickLike {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface AnchorLike {
  href: string;
  target: string;
  hasAttribute(name: string): boolean;
}

/**
 * The in-app address a click on this link would go to, or null when the click does not leave the page (a new tab, a
 * download, another site, the same address, or a link that opens a menu rather than a page).
 */
export function leavingTarget(
  click: ClickLike,
  anchor: AnchorLike | null,
  here: { origin: string; pathname: string; search: string },
): string | null {
  if (!anchor || click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
