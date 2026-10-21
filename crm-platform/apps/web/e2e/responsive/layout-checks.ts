import type { Page } from '@playwright/test';

/**
 * What counts as a layout defect (QA task 20), and how bad it is. P0 and P1 fail the route; P2 is reported only.
 *
 *   P0  a control cannot be reached (it is wholly outside the screen with no scrolling container around it), or the page shows an error
 *       screen or nothing at all
 *   P1  the page scrolls sideways; a control is cut by the screen edge or covered by something in the normal flow; content is cut off by
 *       the screen edge; an image is broken; the viewport meta tag is missing on a phone
 *   P2  text clipped inside its box without an ellipsis; tap targets smaller than 24 px on a phone or tablet
 */
export type Kind =
  | 'error-screen'
  | 'control-unreachable'
  | 'page-overflow-x'
  | 'control-cut-by-edge'
  | 'control-covered'
  | 'content-cut-off'
  | 'broken-image'
  | 'no-viewport-meta'
  | 'text-clipped'
  | 'tiny-targets';

export interface Defect {
  kind: Kind;
  detail: string;
  width?: number;
}

const SEVERITY: Record<Kind, 'P0' | 'P1' | 'P2'> = {
  'error-screen': 'P0',
  'control-unreachable': 'P0',
  'page-overflow-x': 'P1',
  'control-cut-by-edge': 'P1',
  'control-covered': 'P1',
  'content-cut-off': 'P1',
  'broken-image': 'P1',
  'no-viewport-meta': 'P1',
  'text-clipped': 'P2',
  'tiny-targets': 'P2',
};
export const severityOf = (d: Pick<Defect, 'kind'>) => SEVERITY[d.kind];

/** Runs in the page. Returns at most three findings per kind so one broken component does not bury the rest. */
export async function checkLayout(page: Page, width: number): Promise<Defect[]> {
  return page.evaluate((vw) => {
    const out: Array<{ kind: string; detail: string }> = [];
    const per: Record<string, number> = {};
    const add = (kind: string, detail: string) => {
      per[kind] = (per[kind] ?? 0) + 1;
      if (per[kind]! <= 3) out.push({ kind, detail });
    };
    const vh = window.innerHeight;
    const describe = (el: Element) => {
      const h = el as HTMLElement;
      const cls = (h.className && typeof h.className === 'string' ? h.className : '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join('.');
      const text = (h.innerText ?? h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
    };
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0)
        return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hiddenByAttr = (el: Element) => {
      if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return true;
      // the contents of a closed <details> are not shown (their coordinates are stale), only its <summary> is
      const closed = el.closest('details:not([open])');
      return !!closed && !el.closest('summary');
    };
    // a fixed or sticky panel parked off screen (a closed drawer) is not a defect
    const parked = (el: Element) => {
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.position === 'fixed' || s.position === 'sticky') {
          const r = p.getBoundingClientRect();
          if (r.right <= 0 || r.left >= vw) return true;
        }
      }
      return false;
    };
    // a marquee or carousel: an inner box that clips its children and sits inside the screen
    const clippedByInnerBox = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body && p !== document.documentElement;
        p = p.parentElement
      ) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'hidden' || ox === 'clip') {
          const r = p.getBoundingClientRect();
          if (r.left >= -1 && r.right <= vw + 1) return true;
        }
      }
      return false;
    };
    const scrollsSideways = (el: Element) => {
      for (
        let p = el.parentElement;
        p && p !== document.body && p !== document.documentElement;
        p = p.parentElement
      ) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true;
      }
      return false;
    };
    // a control that sits outside the visible box of its own scroll container is not on screen, whatever its coordinates say
    const clippedByScrollBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (
        let p = el.parentElement;
        p && p !== document.body && p !== document.documentElement;
        p = p.parentElement
      ) {
        const s = getComputedStyle(p);
        if (
          ['hidden', 'auto', 'scroll', 'clip'].includes(s.overflowX) ||
          ['hidden', 'auto', 'scroll', 'clip'].includes(s.overflowY)
        ) {
          const b = p.getBoundingClientRect();
          if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return true;
        }
      }
      return false;
    };
    const isControl = (el: Element) =>
      el.matches(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab]',
      );

    // error screen or nothing at all
    const bodyText = (document.body.innerText ?? '').trim();
    if (
      /application error|this page couldn.t load|internal server error|\b(500|404)\b\s*\|?\s*(this page|not found|internal)/i.test(
        bodyText.slice(0, 400),
      ) ||
      // the app's own error screen: a short page that says something went wrong or failed to load
      (bodyText.length < 800 &&
        /something went wrong|failed to load|could not be loaded/i.test(bodyText))
    )
      add('error-screen', bodyText.slice(0, 80).replace(/\s+/g, ' '));
    else if (bodyText.length < 3 && !document.querySelector('canvas, svg, img, video, iframe'))
      add('error-screen', 'the page is empty');

    // viewport meta on a phone
    if (vw <= 768 && !document.querySelector('meta[name="viewport"]'))
      add('no-viewport-meta', 'no <meta name="viewport">');

    // sideways page scroll
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (over > 1) add('page-overflow-x', `${over}px wider than the screen`);

    const all = Array.from(document.body.querySelectorAll('*')).filter(
      (el) =>
        visible(el) &&
        !hiddenByAttr(el) &&
        !parked(el) &&
        !scrollsSideways(el) &&
        !clippedByInnerBox(el),
    );
    const offscreen: Element[] = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const cutRight = r.right > vw + 1;
      const cutLeft = r.left < -1;
      if (!cutRight && !cutLeft) continue;
      offscreen.push(el);
    }
    const off = new Set(offscreen);
    for (const el of offscreen) {
      if (el.parentElement && off.has(el.parentElement)) continue; // report the outermost one only
      const r = el.getBoundingClientRect();
      const whollyOut = r.left >= vw || r.right <= 0;
      const controls = isControl(el)
        ? [el]
        : Array.from(
            el.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea'),
          );
      if (controls.length && whollyOut) add('control-unreachable', describe(el));
      else if (isControl(el))
        add(
          'control-cut-by-edge',
          `${describe(el)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`,
        );
      else if ((el.textContent ?? '').trim().length > 0 || el.querySelector('img, svg'))
        add(
          'content-cut-off',
          `${describe(el)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`,
        );
    }

    // a control covered by something in the normal flow
    for (const el of Array.from(
      document.body.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea'),
    )) {
      if (!visible(el) || hiddenByAttr(el) || parked(el)) continue;
      const r = el.getBoundingClientRect();
      if (clippedByScrollBox(el)) continue;
      if (r.width <= 2 || r.height <= 2) continue; // visually hidden (screen-reader only) controls sit under their visible label by design
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 0 || cx >= vw || cy < 0 || cy >= vh) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!top || top === el || el.contains(top) || top.contains(el)) continue;
      if (top.closest('nextjs-portal')) continue; // the Next.js development overlay, not the product
      if (el.closest('label')?.contains(top)) continue;
      let overlay = false;
      for (let p: Element | null = top; p && p !== document.body; p = p.parentElement) {
        const pos = getComputedStyle(p).position;
        if (pos === 'fixed' || pos === 'sticky') overlay = true;
      }
      if (!overlay) add('control-covered', `${describe(el)} is under ${describe(top)}`);
    }

    // broken images
    for (const img of Array.from(document.images)) {
      if (visible(img) && img.complete && img.naturalWidth === 0 && img.getAttribute('src'))
        add('broken-image', img.currentSrc.slice(0, 80));
    }

    // text clipped without an ellipsis (P2)
    for (const el of all) {
      const s = getComputedStyle(el);
      if (
        (s.overflowX === 'hidden' || s.overflowX === 'clip') &&
        s.textOverflow !== 'ellipsis' &&
        el.scrollWidth > el.clientWidth + 2 &&
        (el.textContent ?? '').trim() &&
        s.display !== 'inline' &&
        el.matches('button, a, label, span, h1, h2, h3, h4, h5, h6, p, td, th, li, dt, dd')
      )
        add('text-clipped', describe(el));
    }

    // small tap targets on phone and tablet (P2, one finding with a count)
    if (vw <= 768) {
      let small = 0;
      for (const el of Array.from(
        document.body.querySelectorAll(
          'button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, [role=button]',
        ),
      )) {
        if (!visible(el) || hiddenByAttr(el) || parked(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 24) small++;
      }
      if (small) add('tiny-targets', `${small} control(s) under 24px`);
    }
    return out;
  }, width) as Promise<Defect[]>;
}

/**
 * Waits until the page has stopped changing: loading indicators gone, and the document height and element count the same for three
 * samples in a row (or 8 s, whichever comes first). Without this a page caught mid-render reports defects that are not there.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load').catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  const deadline = Date.now() + 8000;
  let last = '';
  let same = 0;
  while (Date.now() < deadline && same < 3) {
    const sig = await page.evaluate(() => {
      const busy = document.querySelectorAll(
        '.animate-spin, [aria-busy="true"], [role="progressbar"]',
      ).length;
      return `${busy}|${document.documentElement.scrollHeight}|${document.body.getElementsByTagName('*').length}`;
    });
    same = sig === last && sig.startsWith('0|') ? same + 1 : 0;
    last = sig;
    await page.waitForTimeout(250);
  }
}
