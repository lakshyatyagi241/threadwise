import {
  MARKET_DATA_CHOICES,
  type MarketDataChoice,
  type MarketInstallation,
  type UninstallAppInput,
} from '@crm/contracts';
import type { MarketAccess } from './permissions';

/** What the manage page offers for one installation, given its state and what the person may do. Pure: the page only draws it. */

export interface ManageView {
  killed: boolean;
  paused: boolean;
  needsConsent: boolean;
  /** Accept the permissions of the pending version. Needs `market.apps.install`. */
  canAcceptConsent: boolean;
  /** Edit credentials and settings. Needs `market.apps.manage`; never on a killed installation. */
  canConfigure: boolean;
  /** Pause or resume. */
  canToggle: boolean;
  /** Test the connection (also while paused: it tells the admin whether the service answers). */
  canTest: boolean;
  /** Send a sample lead: the whole path runs, so the installation must be active. */
  canSample: boolean;
  /** Replace the connection secret. */
  canRotate: boolean;
  /** Uninstall: the one thing a killed installation still allows. Needs `market.apps.install`. */
  canUninstall: boolean;
  /** Everything except the header, the banner and uninstall is hidden. */
  onlyUninstall: boolean;
  /** Why an action the person would expect is missing, for the line that explains it. */
  missing: { install: boolean; manage: boolean };
}

export function manageView(
  installation: Pick<MarketInstallation, 'status' | 'needsReconsent' | 'connection'>,
  access: MarketAccess,
  opts: { hasTestPayload: boolean },
): ManageView {
  const killed = installation.status === 'killed';
  const paused = installation.status === 'disabled';
  const hasConnection = installation.connection !== null;
  const manage = access.manage && !killed;
  return {
    killed,
    paused,
    needsConsent: installation.needsReconsent && !killed,
    canAcceptConsent: access.install && installation.needsReconsent && !killed,
    canConfigure: manage,
    canToggle: manage,
    canTest: manage && hasConnection,
    canSample: manage && installation.status === 'active' && hasConnection && opts.hasTestPayload,
    canRotate: manage && installation.connection?.inbound != null,
    canUninstall: access.install,
    onlyUninstall: killed,
    missing: {
      install: !access.install,
      manage: !access.manage && !killed,
    },
  };
}

// --- uninstall -------------------------------------------------------------------------------------------------------------------

export const DATA_CHOICES = MARKET_DATA_CHOICES;
export const DEFAULT_DATA_CHOICE: MarketDataChoice = 'keep';

export const isDataChoice = (v: string): v is MarketDataChoice =>
  (DATA_CHOICES as readonly string[]).includes(v);

export const uninstallBody = (choice: MarketDataChoice): UninstallAppInput => ({
  dataChoice: choice,
});

// --- usage -----------------------------------------------------------------------------------------------------------------------

export interface UsageView {
  installed: number;
  /** 0 on the wire means unlimited. */
  limit: number;
  unlimited: boolean;
  /** At the cap: one more install is refused until something is uninstalled or the plan grows. */
  atCap: boolean;
  /** Close to the cap (one place left, or the last fifth): drawn in the warning style. */
  nearCap: boolean;
  remaining: number | null;
  tone: 'normal' | 'near' | 'full';
}

export function usageView(usage: { installed: number; limit: number }): UsageView {
  const installed = Math.max(0, usage.installed);
  const limit = Math.max(0, usage.limit);
  if (limit === 0) {
    return {
      installed,
      limit,
      unlimited: true,
      atCap: false,
      nearCap: false,
      remaining: null,
      tone: 'normal',
    };
  }
  const remaining = Math.max(0, limit - installed);
  const atCap = installed >= limit;
  const nearCap = !atCap && remaining <= Math.max(1, Math.floor(limit * 0.2));
  return {
    installed,
    limit,
    unlimited: false,
    atCap,
    nearCap,
    remaining,
    tone: atCap ? 'full' : nearCap ? 'near' : 'normal',
  };
}
