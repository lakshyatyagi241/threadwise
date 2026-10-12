/**
 * The popup embed (docs/api/forms-builder.md, "The embed loader"): the same hosted form in a dialog that opens on a trigger. The loader
 * reads its options from attributes on the element the owner pastes, so changing them means copying the code again; nothing about it is
 * stored on the form. These are the pure parts: the options, their limits (the loader clamps to the same numbers) and the snippet.
 */

export const POPUP_TRIGGERS = ['delay', 'scroll_down', 'scroll_up', 'click'] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];
export const POPUP_POSITIONS = ['center', 'bottom_right'] as const;
export type PopupPosition = (typeof POPUP_POSITIONS)[number];

export const POPUP_LIMITS = {
  delay: { min: 0, max: 600, fallback: 5 },
  scroll: { min: 5, max: 100, fallback: 50 },
  days: { min: 0, max: 365, fallback: 7 },
} as const;

export interface PopupOptions {
  trigger: PopupTrigger;
  /** Seconds after the page loads (trigger `delay`). */
  delay: number;
  /** Percent of the page scrolled (trigger `scroll_down`). */
  scroll: number;
  position: PopupPosition;
  /** Days before it may show to the same visitor again; 0 = every visit. A submitted form never shows again. */
  days: number;
}

export const DEFAULT_POPUP: PopupOptions = {
  trigger: 'delay',
  delay: POPUP_LIMITS.delay.fallback,
  scroll: POPUP_LIMITS.scroll.fallback,
  position: 'center',
  days: POPUP_LIMITS.days.fallback,
};

type Limit = { min: number; max: number; fallback: number };

/** A whole number inside its limits; anything else (empty, text, out of range) is held to the nearest legal value or the fallback. */
export function clampWhole(value: unknown, limit: Limit): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return limit.fallback;
  return Math.min(limit.max, Math.max(limit.min, Math.round(n)));
}

const attr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The two lines the owner pastes: the element carrying the options, then the loader. Only the options that matter for the trigger are written. */
export function popupSnippet(input: {
  key: string;
  scriptUrl: string;
  title: string;
  options: PopupOptions;
}): string {
  const o = input.options;
  const attrs = [
    `data-forms-key="${attr(input.key)}"`,
    'data-forms-mode="popup"',
    `data-forms-trigger="${o.trigger}"`,
    ...(o.trigger === 'delay'
      ? [`data-forms-delay="${clampWhole(o.delay, POPUP_LIMITS.delay)}"`]
      : []),
    ...(o.trigger === 'scroll_down'
      ? [`data-forms-scroll="${clampWhole(o.scroll, POPUP_LIMITS.scroll)}"`]
      : []),
    `data-forms-position="${o.position}"`,
    `data-forms-days="${clampWhole(o.days, POPUP_LIMITS.days)}"`,
    `data-forms-title="${attr(input.title)}"`,
  ];
  return `<div ${attrs.join(' ')}></div>\n<script src="${attr(input.scriptUrl)}" async></script>`;
}

/** The element that opens the popup on a click, whatever the trigger. */
export function popupButtonSnippet(key: string, label = 'Open form'): string {
  return `<button type="button" data-forms-open="${attr(key)}">${attr(label)}</button>`;
}
