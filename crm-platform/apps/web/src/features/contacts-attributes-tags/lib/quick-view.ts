import { parseSection, type SectionId } from './sections';

/**
 * The quick view lives in the URL (`?contact=<uuid>&panel=<section>`) beside the list's own filters, so a link to it can be shared and
 * the back button closes it. These helpers only touch those two parameters.
 */
export const CONTACT_PARAM = 'contact';
export const PANEL_PARAM = 'panel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Pick<URLSearchParams, 'get'>;

/** The contact the quick view shows; empty when none is open or the value is not an id. */
export function quickViewIdOf(params: Params): string {
  const v = params.get(CONTACT_PARAM) ?? '';
  return UUID.test(v) ? v.toLowerCase() : '';
}

/** The open rail section; the overview when absent or unknown. */
export function quickViewPanelOf(params: Params): SectionId {
  return parseSection(params.get(PANEL_PARAM)) ?? 'overview';
}

/** `search` ("?a=b" or "a=b") with the quick view opened on `id` (and `panel` when it is not the overview), or closed when `id` is empty. */
export function withQuickView(search: string, id: string, panel: SectionId = 'overview'): string {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  p.delete(CONTACT_PARAM);
  p.delete(PANEL_PARAM);
  if (id) {
    p.set(CONTACT_PARAM, id);
    if (panel !== 'overview') p.set(PANEL_PARAM, panel);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface Neighbours {
  /** Position of the contact among the loaded rows, or -1 when it is not on the page. */
  index: number;
  previous: string | null;
  next: string | null;
}

/** The contacts before and after `id` among the rows on screen; both null at the edges and when `id` is not among them. */
export function neighboursOf(ids: readonly string[], id: string): Neighbours {
  const index = ids.indexOf(id);
  if (index < 0) return { index, previous: null, next: null };
  return { index, previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}

/**
 * Whether a key press should move to the previous or next contact: the arrow keys, with no modifier, and not while the person
 * is typing, choosing in a menu or using a control that owns the arrows.
 */
export function neighbourKey(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  target: {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (n: string) => string | null;
  } | null,
  rtl = false,
): 'previous' | 'next' | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const tag = (target?.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable)
    return null;
  const role = target?.getAttribute?.('role') ?? '';
  if (
    ['tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radio', 'slider', 'option'].includes(
      role,
    )
  )
    return null;
  if (e.key === 'ArrowUp') return 'previous';
  if (e.key === 'ArrowDown') return 'next';
  if (e.key === 'ArrowLeft') return rtl ? 'next' : 'previous';
  if (e.key === 'ArrowRight') return rtl ? 'previous' : 'next';
  return null;
}
