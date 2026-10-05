/**
 * The guided tour's steps (WD-ASHELL-023). Copy lives in `admin-console-shell.tour.steps.<id>`; a step with no target is a
 * centred welcome card. WaDesk skipped any step whose anchor was missing or hidden; that stays, so the tour adapts by itself:
 * below `lg` the menu steps vanish, in sidebar mode only the welcome and dashboard steps remain.
 */
export interface TourStep {
  id: string;
  /** CSS selector of the element to spotlight; absent for the welcome card. */
  target?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome' },
  { id: 'navbar', target: '[data-tour="navbar"]' },
  { id: 'metaads', target: '[data-tour="nav-metaads"]' },
  { id: 'campaigns', target: '[data-tour="nav-wa-campaigns"]' },
  { id: 'flows', target: '[data-tour="nav-flows"]' },
  { id: 'templates', target: '[data-tour="nav-templates"]' },
  { id: 'devices', target: '[data-tour="nav-devices"]' },
  { id: 'more', target: '[data-tour="nav-more"]' },
  { id: 'kpi', target: '[data-tour="kpi"]' },
  { id: 'newCampaign', target: '[data-tour="new-campaign"]' },
  { id: 'pipeline', target: '[data-tour="pipeline"]' },
];

/** The steps that can be shown now: the welcome card always, a targeted step only if its element is on screen. */
export function planTour(isVisible: (selector: string) => boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => !s.target || isVisible(s.target));
}

export interface TourGate {
  /** The person has not seen the tour yet (`GET /v2/shell/config`). */
  run: boolean;
  pathname: string;
  /** The URL carries `?tour=1`. */
  forced: boolean;
}

/** Auto-runs only on exactly `/dashboard`, and only for someone who has not seen it, or when `?tour=1` asks for a replay. */
export const shouldRunTour = ({ run, pathname, forced }: TourGate): boolean =>
  pathname === '/dashboard' && (run || forced);

export const TOUR_START_EVENT = 'shell:start-tour';
export const TOUR_DELAY_MS = 650;
