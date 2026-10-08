/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

/**
 * The AI report assistant's console page, merged into the console menu by
 * `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator imports every nav.ts).
 * It sits in the Reports hub (`admin-console-shell/console-layout.ts`) and is shown to super admins and auditors
 * (`admin-console-shell/console-access.ts`); only a super admin may change the document library.
 */
export const REPORT_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  {
    id: 'ai-reports',
    href: '/admin/reports',
    labelKey: 'report-copilot.nav.title',
    groupKey: 'dashboards-analytics-charts.health.group',
  },
];
