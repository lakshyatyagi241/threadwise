import { redirect } from 'next/navigation';
import { NAV } from '@/features/_registry/nav.generated';
import {
  buildHubTabs,
  tabRedirect,
  tabsFromNav,
} from '@/features/auth-registration-security/account/hub/hub-tabs';

/**
 * `/account` is the hub's front door. `?tab=<name>` is WaDesk's deep-link shape
 * (`?tab=password`, `?tab=delete`, ...) and lands on the pane's own route, keeping
 * any other parameter (`required`); no tab, or an unknown one, opens the profile.
 */
export default async function AccountIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tabs = buildHubTabs(tabsFromNav(NAV));
  redirect(tabRedirect(await searchParams, tabs));
}
