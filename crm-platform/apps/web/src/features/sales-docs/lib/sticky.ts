/**
 * The frozen start of the table: the selection checkbox and the Number cell stay put while the other columns scroll sideways.
 * Classes are plain strings so a test can assert them without a browser. Cells are opaque (a sticky cell over a transparent
 * one would show the scrolling text through it) and take the row's hover, selected and active colours themselves through the
 * `group` on the row.
 */

/** Width in px of the checkbox column; the Number cell sticks right after it (`sm:start-12` is the same 48px). */
export const SELECT_W = 48;

const SURFACE =
  'bg-background group-hover:bg-muted group-data-[active=true]:bg-muted group-data-[selected=true]:bg-[color-mix(in_srgb,var(--brand)_8%,var(--background))]';

export const STICKY_SELECT = `sm:sticky sm:start-0 sm:z-10 ${SURFACE}`;
export const STICKY_SELECT_HEAD = 'sm:start-0 sm:z-30 bg-muted';
export const STICKY_FIRST = `sticky start-0 sm:start-12 z-10 ${SURFACE}`;
export const STICKY_FIRST_HEAD = 'start-0 sm:start-12 z-30 bg-muted';

/** Shadow along the frozen edge, mirrored in RTL, only while the table is scrolled sideways. */
export const FROZEN_SHADOW =
  'shadow-[6px_0_8px_-4px_rgba(15,23,42,0.18)] rtl:shadow-[-6px_0_8px_-4px_rgba(15,23,42,0.18)] ' +
  'dark:shadow-[6px_0_8px_-4px_rgba(0,0,0,0.6)] dark:rtl:shadow-[-6px_0_8px_-4px_rgba(0,0,0,0.6)]';

export const frozenEdge = (scrolled: boolean) => (scrolled ? FROZEN_SHADOW : '');

/** "Scrolled sideways" from a scroll container's offset; RTL containers report negative offsets. */
export const isScrolledSideways = (scrollLeft: number) => Math.abs(scrollLeft) > 1;

export const COLUMN_IDS = [
  'number',
  'title',
  'contact',
  'amount',
  'status',
  'validUntil',
  'owner',
  'created',
] as const;
export type ColumnId = (typeof COLUMN_IDS)[number];

/** Column widths in px; the table is fixed-layout and scrolls sideways inside its card when they do not fit. */
export const WIDTH: Record<ColumnId, number> = {
  number: 150,
  title: 300,
  contact: 200,
  amount: 150,
  status: 130,
  validUntil: 140,
  owner: 170,
  created: 140,
};

export const tableMinWidth = (): number =>
  SELECT_W + COLUMN_IDS.reduce((sum, id) => sum + WIDTH[id], 0);
