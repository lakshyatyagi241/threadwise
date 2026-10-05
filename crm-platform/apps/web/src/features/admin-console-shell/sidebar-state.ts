/** Remembers whether the admin rail is collapsed, so the server can render it that way on the first paint. */
export const CONSOLE_SIDEBAR_COOKIE = 'crm_console_sidebar';

export type SidebarState = 'expanded' | 'collapsed';

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Anything but an exact `collapsed` is expanded: a tampered or missing cookie must never hide the menu. */
export const parseSidebarState = (value: string | null | undefined): SidebarState =>
  value === 'collapsed' ? 'collapsed' : 'expanded';

/** The `document.cookie` assignment for a state. Read by the server layout, so it is not httpOnly. */
export const sidebarCookie = (state: SidebarState): string =>
  `${CONSOLE_SIDEBAR_COOKIE}=${state}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;

/** Remembers the state in the browser (client only), so the next page is rendered that way on the server. */
export const saveSidebarState = (state: SidebarState): void => {
  document.cookie = sidebarCookie(state);
};
