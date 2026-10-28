/**
 * Covers the page with Geta's loader (the turning ring around the breathing logo, as `GetaLoader` draws it) for the moment
 * between "signed in" or "signed out" and the next page. Both leave through a full page navigation, which can take a while on a
 * slow network or a cold server; this keeps the old page from sitting there looking stuck. It is plain DOM, not React: the page
 * is about to be replaced, and the overlay stays until the browser swaps it. Calling it twice adds nothing.
 */
const ID = 'geta-transition-loader';
const LOGO = '/images/geta-logo.png';

export function showTransitionLoader(): void {
  if (typeof document === 'undefined' || document.getElementById(ID)) return;
  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-busy', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:var(--background,#fff)';
  overlay.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:64px">
      <div class="geta-loader-ring" style="position:absolute;inset:0;border-radius:9999px;border:3px solid transparent"></div>
      <img class="geta-loader-logo" src="${LOGO}" alt="" width="30" height="30" style="border-radius:2px" />
      <style>
        #${ID} .geta-loader-ring {
          border-top-color: var(--primary, #3214db);
          border-right-color: color-mix(in srgb, var(--primary, #3214db) 30%, transparent);
          animation: geta-loader-spin 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        #${ID} .geta-loader-logo { animation: geta-loader-breathe 1.8s ease-in-out infinite; }
        @keyframes geta-loader-spin { to { transform: rotate(360deg); } }
        @keyframes geta-loader-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @media (prefers-reduced-motion: reduce) {
          #${ID} .geta-loader-ring, #${ID} .geta-loader-logo { animation: none; }
        }
      </style>
    </div>`;
  document.body.appendChild(overlay);
}
