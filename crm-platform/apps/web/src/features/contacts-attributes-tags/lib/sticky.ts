/**
 * The frozen start of the table: the selection checkbox and the Name cell stay put while the other columns scroll
 * sideways. Classes are plain strings so a test can assert them without a browser.
 *
 * Cells are opaque (a sticky cell over a transparent one would show the scrolling text through it) and take the row's
 * hover and selected colours themselves through the `group` on the row.
 */

/** Width in px of the checkbox column; the Name cell sticks right after it (`sm:start-12` is the same 48px). */
export const SELECT_W = 48;

const SURFACE =
  'bg-background group-hover:bg-muted group-data-[selected=true]:bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]';

/** Checkbox cell: frozen from `sm` up (on a phone the Name cell takes the whole frozen width). */
export const STICKY_SELECT = `sm:sticky sm:start-0 sm:z-10 ${SURFACE}`;

/** Header cells are always sticky at the top; these add the start edge and sit above the body cells sliding under them. */
export const STICKY_SELECT_HEAD = 'sm:start-0 sm:z-30 bg-muted';

/** Name cell: always frozen; after the checkbox column from `sm` up, at the very start on a phone. */
export const STICKY_NAME = `sticky start-0 sm:start-12 z-10 ${SURFACE}`;
export const STICKY_NAME_HEAD = 'start-0 sm:start-12 z-30 bg-muted';

/** The same frozen Name cell when the table has no checkbox column (a read-only listing): it sits at the very start. */
export const STICKY_NAME_ALONE = `sticky start-0 z-10 ${SURFACE}`;
export const STICKY_NAME_ALONE_HEAD = 'start-0 z-30 bg-muted';

/** Shadow along the frozen edge, mirrored in RTL, only while the table is scrolled sideways. */
export const FROZEN_SHADOW =
  'shadow-[6px_0_8px_-4px_rgba(15,23,42,0.18)] rtl:shadow-[-6px_0_8px_-4px_rgba(15,23,42,0.18)] ' +
  'dark:shadow-[6px_0_8px_-4px_rgba(0,0,0,0.6)] dark:rtl:shadow-[-6px_0_8px_-4px_rgba(0,0,0,0.6)]';

export const frozenEdge = (scrolled: boolean) => (scrolled ? FROZEN_SHADOW : '');

/** "Scrolled sideways" from a scroll container's offset; RTL containers report negative offsets. */
export const isScrolledSideways = (scrollLeft: number) => Math.abs(scrollLeft) > 1;
