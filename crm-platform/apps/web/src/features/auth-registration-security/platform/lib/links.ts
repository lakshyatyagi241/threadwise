import type { SecurityTab } from './policy-draft';

/**
 * The operator list of workspaces. The console's workspace screens belong to the admin-console
 * domain and are not built yet, so this address does not resolve until they land.
 */
export const WORKSPACES_HREF = '/admin/workspaces';

/** A Security Center tab by link (the tab lives in the URL hash). */
export const securityTabHref = (tab: SecurityTab): string => `/admin/security#${tab}`;

/** Where the sign-up policy (Terms and Privacy addresses) is edited. */
export const REGISTRATION_SETTINGS_HREF = '/admin/settings/registration';
