/** The three views behind the dropdown at the top of the dashboard. */
export const DASH_VIEWS = ['summary', 'agent', 'bot'] as const;
export type DashView = (typeof DASH_VIEWS)[number];

/** A route parameter as a view: anything that is not one of the three is the summary. */
export const asDashView = (value: string | string[] | undefined): DashView => {
  const one = Array.isArray(value) ? value[0] : value;
  return (DASH_VIEWS as readonly string[]).includes(one ?? '') ? (one as DashView) : 'summary';
};
