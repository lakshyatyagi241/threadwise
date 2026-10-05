/** One entry of the operator console menu (same shape as the shell's `OperatorNavItem`). */
interface OperatorNavEntry {
  id: string;
  href: string;
  labelKey: string;
  groupKey: string;
}

const NS = 'platform-support-desk.nav';
const GROUP = `${NS}.group`;

/**
 * Reference's "Support" menu group: Inbox, Team inbox (kanban), Agents, SLA board, Customers, Playbooks, Reports. Merged into the
 * console menu by `auth-registration-security/platform/operator-nav.ts` (not named nav.ts: the customer-menu generator
 * imports every nav.ts). The platform inbox (cross-workspace conversations) has no menu entry in Reference (reached by address);
 * here it sits in the same group so it can be found. Reference's per-item count badges have no slot in this menu.
 */
export const SUPP_OPERATOR_NAV: readonly OperatorNavEntry[] = [
  { id: 'support-inbox', href: '/admin/support', labelKey: `${NS}.inbox`, groupKey: GROUP },
  {
    id: 'support-team',
    href: '/admin/support/team-inbox',
    labelKey: `${NS}.team`,
    groupKey: GROUP,
  },
  {
    id: 'support-agents',
    href: '/admin/support/agents',
    labelKey: `${NS}.agents`,
    groupKey: GROUP,
  },
  { id: 'support-sla', href: '/admin/support/sla', labelKey: `${NS}.sla`, groupKey: GROUP },
  {
    id: 'support-customers',
    href: '/admin/support/customers',
    labelKey: `${NS}.customers`,
    groupKey: GROUP,
  },
  {
    id: 'support-playbooks',
    href: '/admin/support/playbooks',
    labelKey: `${NS}.playbooks`,
    groupKey: GROUP,
  },
  {
    id: 'support-reports',
    href: '/admin/support/reports',
    labelKey: `${NS}.reports`,
    groupKey: GROUP,
  },
  {
    id: 'support-platform-inbox',
    href: '/admin/team-inbox',
    labelKey: `${NS}.platformInbox`,
    groupKey: GROUP,
  },
];
