/**
 * "Show me instead": a ring around the control the person should use, drawn by us (the page-agent library has no such thing). The ring
 * is not part of the page the model reads (`data-page-agent-ignore`), does not take clicks, and follows the control while the page
 * scrolls. One ring at a time; `clearHighlight` removes it.
 */
const RING_ID = 'help-agent-ring';
let cleanup: (() => void) | null = null;

export function clearHighlight(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(RING_ID)?.remove();
}

export function highlightElement(el: Element, label: string): void {
  clearHighlight();
  (el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'nearest' });
  const ring = document.createElement('div');
  ring.id = RING_ID;
  ring.setAttribute('data-page-agent-ignore', 'true');
  ring.setAttribute('aria-hidden', 'true');
  ring.setAttribute('data-label', label);
  Object.assign(ring.style, {
    position: 'fixed',
    zIndex: '2147483000',
    pointerEvents: 'none',
    border: '3px solid var(--primary, #3214db)',
    borderRadius: '10px',
    boxShadow: '0 0 0 4px color-mix(in srgb, var(--primary, #3214db) 25%, transparent)',
    transition: 'all 120ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ring);

  const place = () => {
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, {
      top: `${r.top - 4}px`,
      left: `${r.left - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
    });
  };
  place();
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  cleanup = () => {
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  };
}
