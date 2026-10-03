/**
 * The account hub's public surface for other domains (TW-AUTH-024).
 *
 * To add a pane to the hub (Plan, Orders, Wallet, Add-ons, Affiliate, Support,
 * Translation, ...) a domain does two things, both inside its own files:
 *
 *  1. declares it in its `features/<domain>/nav.ts` as `{ id, group: 'settings',
 *     labelKey, href: '/account/<name>', order }` (`order` below 100 joins the
 *     "Account" menu group, 100 or more the "Security" group; see `hub-tabs.ts`);
 *  2. wraps the pane's page in `AccountFrame`, from its own route group.
 *
 * The menu, the breadcrumb and `/account?tab=<name>` then pick it up.
 */
export { AccountFrame } from '../account/hub/account-frame';
export {
  OWN_TABS,
  buildHubTabs,
  currentTab,
  resolveTabParam,
  tabsFromNav,
  type HubTab,
} from '../account/hub/hub-tabs';
