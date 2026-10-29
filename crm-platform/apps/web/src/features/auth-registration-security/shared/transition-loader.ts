import { startGetaLoaderAnimation } from '@crm/ui';

/**
 * Covers the page with Geta's loader (the glowing arcs turning around the logo, as `GetaLoader` draws them) for the moment
 * between "signed in" or "signed out" and the next page. Both leave through a full page navigation, which can take a while on a
 * slow network or a cold server; this keeps the old page from sitting there looking stuck. It is plain DOM, not React: the page
 * is about to be replaced, and the overlay stays until the browser swaps it. Calling it twice adds nothing.
 */
const ID = 'geta-transition-loader';
const LOGO = '/images/geta-logo.png';
const SIZE = 140;

export function showTransitionLoader(): void {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-busy', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:var(--background,#fff)';

  const box = document.createElement('div');
  box.style.cssText = `position:relative;display:flex;align-items:center;justify-content:center;width:${SIZE}px;height:${SIZE}px`;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0';
  const logo = document.createElement('img');
  logo.src = LOGO;
  logo.alt = '';
  const logoSize = Math.round(SIZE / 3);
  logo.width = logoSize;
  logo.height = logoSize;
  logo.style.cssText = 'position:relative;object-fit:contain';
  box.append(canvas, logo);
  overlay.append(box);
  document.body.appendChild(overlay);
  startGetaLoaderAnimation(canvas, SIZE);
}
