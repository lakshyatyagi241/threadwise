import {
  PLAN_LIMIT_DEFS,
  PLAN_LIMIT_GROUPS,
  isUnlimitedFor,
  limitZeroIsNone,
  type PlanLimitGroup,
  type PlanLimitKey,
  type WorkspaceAddons,
} from '@crm/contracts';

/** The one cap where 0 means "use the platform default" (not unlimited); an override of -1 means unlimited. */
export const PLATFORM_DEFAULT_KEY: PlanLimitKey = 'api_rate_limit_per_minute';

/** The limit keys under their group, in catalogue order; empty groups are left out. */
export function limitGroups(): { group: PlanLimitGroup; keys: PlanLimitKey[] }[] {
  return PLAN_LIMIT_GROUPS.map((group) => ({
    group,
    keys: PLAN_LIMIT_DEFS.filter((d) => d.group === group).map((d) => d.key),
  })).filter((g) => g.keys.length > 0);
}

export interface LimitRowState {
  /** The override box holds a value (anything but empty). */
  overridden: boolean;
  /** -1 for every cap; 0 too for the caps where 0 means unlimited. Shown as the "Unlimited" checkbox. */
  unlimited: boolean;
  /** api_rate_limit_per_minute set to 0: the platform default applies. */
  platformDefault: boolean;
}

/** What one override row means for the text in its box. */
export function limitRowState(key: string, raw: string): LimitRowState {
  const v = raw.trim();
  if (v === '' || !/^-?\d+$/.test(v)) {
    return { overridden: false, unlimited: false, platformDefault: false };
  }
  const n = Number(v);
  const isDefaultKey = key === PLATFORM_DEFAULT_KEY;
  return {
    overridden: true,
    // `teams`: an override of 0 is "solo", not unlimited.
    unlimited: n < 0 || (n === 0 && !isDefaultKey && !limitZeroIsNone(key)),
    platformDefault: n === 0 && isDefaultKey,
  };
}

/** The text a toggled "Unlimited" checkbox writes into the box: -1, or empty (back to the plan's value). */
export const unlimitedToggle = (on: boolean): string => (on ? '-1' : '');

export type PlanValueView =
  { kind: 'unlimited' } | { kind: 'platformDefault' } | { kind: 'value'; value: number };

/** The plan's own cap, for reference next to the override. */
export function planValueView(key: string, planValue: number): PlanValueView {
  if (limitZeroIsNone(key)) {
    return isUnlimitedFor(key, planValue)
      ? { kind: 'unlimited' }
      : { kind: 'value', value: planValue };
  }
  if (planValue === 0) {
    return key === PLATFORM_DEFAULT_KEY ? { kind: 'platformDefault' } : { kind: 'unlimited' };
  }
  return planValue < 0 ? { kind: 'unlimited' } : { kind: 'value', value: planValue };
}

export interface AddonLists {
  /** What the plan makes visible, in the API order. */
  visible: WorkspaceAddons['visible'];
  /** Owned, but the plan no longer shows them: still usable, kept until they end. */
  former: WorkspaceAddons['owned'];
}

export function addonLists(addons: WorkspaceAddons): AddonLists {
  return {
    visible: addons.visible,
    former: addons.owned
      .filter((o) => !o.visibleOnPlan)
      .sort((a, b) => a.app.name.localeCompare(b.app.name)),
  };
}
