import type { MarketAppCard, MarketHealth, MarketInstallStatus, MarketLock } from '@crm/contracts';
import { mktRoutes, safeInternalPath } from './routes';

/** What the person is told about an installation (chips) and what a card offers (call to action). Pure: the components only draw it. */

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface Chip {
  /** Message key under `marketplace.chips`. */
  key: string;
  tone: ChipTone;
}

export const STATUS_CHIP_KEYS = ['installed', 'paused', 'killed'] as const;
export const HEALTH_CHIP_KEYS = [
  'healthy',
  'degraded',
  'error',
  'needs_reauth',
  'unknown',
] as const;

export function statusChip(status: MarketInstallStatus): Chip {
  switch (status) {
    case 'active':
      return { key: 'installed', tone: 'success' };
    case 'disabled':
      return { key: 'paused', tone: 'warning' };
    case 'killed':
      return { key: 'killed', tone: 'danger' };
  }
}

export function healthChip(health: MarketHealth): Chip {
  switch (health) {
    case 'healthy':
      return { key: 'healthy', tone: 'success' };
    case 'degraded':
      return { key: 'degraded', tone: 'warning' };
    case 'error':
      return { key: 'error', tone: 'danger' };
    case 'needs_reauth':
      return { key: 'needs_reauth', tone: 'danger' };
    case 'unknown':
      return { key: 'unknown', tone: 'neutral' };
  }
}

export const NEEDS_CONSENT_CHIP: Chip = { key: 'needsConsent', tone: 'warning' };

export interface InstallLike {
  status: MarketInstallStatus;
  health: MarketHealth;
  needsReconsent: boolean;
}

/**
 * The chips of one installation, in the order they are drawn.
 * - Killed by the platform: that chip only. Health and consent mean nothing when only uninstalling is possible.
 * - Paused by the admin: Paused, then the consent chip when a newer version waits.
 * - Active: Installed, then health (hidden while it is still `unknown` on a card; the manage page passes `showUnknown`), then consent.
 */
export function installChips(install: InstallLike, opts: { showUnknown?: boolean } = {}): Chip[] {
  if (install.status === 'killed') return [statusChip('killed')];
  const chips: Chip[] = [statusChip(install.status)];
  if (install.status === 'active' && (install.health !== 'unknown' || opts.showUnknown)) {
    chips.push(healthChip(install.health));
  }
  if (install.needsReconsent) chips.push(NEEDS_CONSENT_CHIP);
  return chips;
}

/** The chips of a full installation (its health is an object there, a plain state on a card). */
export function installationChips(
  i: { status: MarketInstallStatus; health: { status: MarketHealth }; needsReconsent: boolean },
  opts: { showUnknown?: boolean } = {},
): Chip[] {
  return installChips(
    { status: i.status, health: i.health.status, needsReconsent: i.needsReconsent },
    opts,
  );
}

// --- lock (plan, module, cap) ----------------------------------------------------------------------------------------------------

export const LOCK_REASONS = ['plan_feature', 'module_disabled', 'limit_reached'] as const;

export interface LockView {
  reason: MarketLock['reason'];
  /** Message key under `marketplace.lock`. */
  key: 'planFeature' | 'moduleDisabled' | 'limitReached';
  /** The plan feature or module slug the lock is about, for the line under the chip. */
  subject: string | null;
  /** Where "upgrade" goes; null when upgrading would not help (the module is not installed on this server). */
  upgradeHref: string | null;
}

export function lockView(locked: MarketLock | null | undefined): LockView | null {
  if (!locked) return null;
  switch (locked.reason) {
    case 'plan_feature':
      return {
        reason: locked.reason,
        key: 'planFeature',
        subject: locked.key,
        upgradeHref: safeInternalPath(locked.upgradeUrl),
      };
    case 'limit_reached':
      return {
        reason: locked.reason,
        key: 'limitReached',
        subject: locked.key,
        upgradeHref: safeInternalPath(locked.upgradeUrl),
      };
    case 'module_disabled':
      return {
        reason: locked.reason,
        key: 'moduleDisabled',
        subject: locked.key,
        upgradeHref: locked.upgradeUrl ? safeInternalPath(locked.upgradeUrl) : null,
      };
  }
}

/** An installed app is never locked, whatever the response says. */
export function effectiveLock(card: Pick<MarketAppCard, 'install' | 'locked'>): LockView | null {
  return card.install ? null : lockView(card.locked);
}

// --- card call to action ---------------------------------------------------------------------------------------------------------

export const CTA_KINDS = [
  /** Installed and fine: manage it. */
  'manage',
  /** A newer version waits for the person's consent: the manage page has the button. */
  'review',
  /** The platform switched it off: only uninstalling is left, on the manage page. */
  'killed',
  /** Not installed, can install: go to the install flow. */
  'install',
  /** Not installed, cannot install it now (plan, module, cap): details and an upgrade prompt. */
  'locked',
  /** Not installed and the person lacks `market.apps.install`: details only. */
  'view',
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

export interface Cta {
  kind: CtaKind;
  href: string;
  /** Present for `locked`: where the upgrade prompt goes (null when upgrading would not help). */
  upgradeHref: string | null;
}

export function cardCta(
  card: Pick<MarketAppCard, 'slug' | 'install' | 'locked'>,
  can: { install: boolean },
): Cta {
  if (card.install) {
    const href = mktRoutes.manage(card.install.installationId);
    if (card.install.status === 'killed') return { kind: 'killed', href, upgradeHref: null };
    if (card.install.needsReconsent) return { kind: 'review', href, upgradeHref: null };
    return { kind: 'manage', href, upgradeHref: null };
  }
  const detail = mktRoutes.app(card.slug);
  const lock = lockView(card.locked);
  if (lock) return { kind: 'locked', href: detail, upgradeHref: lock.upgradeHref };
  if (!can.install) return { kind: 'view', href: detail, upgradeHref: null };
  return { kind: 'install', href: mktRoutes.install(card.slug), upgradeHref: null };
}

/** The install button of the app page: whether it is offered, disabled with a reason, or replaced. */
export type InstallGate =
  | { kind: 'allowed'; href: string }
  | { kind: 'installed'; href: string }
  | { kind: 'killed'; href: string }
  | { kind: 'locked'; lock: LockView }
  | { kind: 'noPermission'; permission: 'market.apps.install' };

export function installGate(
  card: Pick<MarketAppCard, 'slug' | 'install' | 'locked'>,
  can: { install: boolean },
): InstallGate {
  if (card.install) {
    const href = mktRoutes.manage(card.install.installationId);
    return card.install.status === 'killed'
      ? { kind: 'killed', href }
      : { kind: 'installed', href };
  }
  const lock = lockView(card.locked);
  if (lock) return { kind: 'locked', lock };
  if (!can.install) return { kind: 'noPermission', permission: 'market.apps.install' };
  return { kind: 'allowed', href: mktRoutes.install(card.slug) };
}
