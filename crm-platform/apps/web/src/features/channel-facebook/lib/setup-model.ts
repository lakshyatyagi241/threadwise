import type { IceBreaker, MenuItem, MessengerSetup } from '@crm/contracts';

/** Meta's caps, which the screen enforces as Reference's did. */
export const MENU_MAX = 3;
export const ICE_MAX = 4;
export const GREETING_MAX = 160;
export const MENU_TITLE_MAX = 30;
export const ICE_QUESTION_MAX = 80;
export const PAYLOAD_MAX = 1000;

export const blankMenuItem = (): MenuItem => ({
  title: '',
  type: 'postback',
  url: '',
  payload: '',
});
export const blankIceBreaker = (): IceBreaker => ({ question: '', payload: '' });

/** A group never shows empty: with nothing saved it opens on one blank row. */
export const seedRows = <T>(rows: readonly T[], blank: () => T): T[] =>
  rows.length > 0 ? [...rows] : [blank()];

/** Adds a blank row unless the group is full. */
export const addRow = <T>(rows: readonly T[], blank: () => T, max: number): T[] =>
  rows.length >= max ? [...rows] : [...rows, blank()];

/** Removes a row; the last remaining one is cleared instead, so the group never collapses. */
export const removeRow = <T>(rows: readonly T[], index: number, blank: () => T): T[] =>
  rows.length <= 1 ? [blank()] : rows.filter((_, i) => i !== index);

export const patchRow = <T>(rows: readonly T[], index: number, patch: Partial<T>): T[] =>
  rows.map((r, i) => (i === index ? { ...r, ...patch } : r));

export type SetupTab = 'getstarted' | 'greeting' | 'menu' | 'icebreakers';
export const SETUP_TABS: readonly SetupTab[] = ['getstarted', 'greeting', 'menu', 'icebreakers'];

/** Which pieces of the profile are set up: the dot on each tab. */
export function tabsSet(v: MessengerSetup): Record<SetupTab, boolean> {
  return {
    getstarted: v.getStarted !== '',
    greeting: v.greeting !== '',
    menu: v.menu.items.length > 0,
    icebreakers: v.iceBreakers.length > 0,
  };
}

/** The tab to open first: the first piece that is set up, else Get Started. */
export function firstTab(v: MessengerSetup): SetupTab {
  const set = tabsSet(v);
  return SETUP_TABS.find((t) => set[t]) ?? 'getstarted';
}

/** What the menu preview lists: the saved items (at most three), or sample rows while there are none. */
export function menuPreviewTitles(
  items: readonly MenuItem[],
  samples: readonly string[],
): string[] {
  return (items.length > 0 ? items.map((i) => i.title) : [...samples]).slice(0, MENU_MAX);
}

/** What the ice-breaker preview lists: the saved questions (at most four), or samples while there are none. */
export function iceBreakerPreview(
  items: readonly IceBreaker[],
  samples: readonly string[],
): string[] {
  return (items.length > 0 ? items.map((i) => i.question) : [...samples]).slice(0, ICE_MAX);
}
