/** The three views behind the dropdown at the top of the dashboard. */
export const DASH_VIEWS = ['summary', 'agent', 'bot'] as const;
export type DashView = (typeof DASH_VIEWS)[number];
