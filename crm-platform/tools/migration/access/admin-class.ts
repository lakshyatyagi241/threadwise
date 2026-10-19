/**
 * Admin-class keys: the ones that let a person run the workspace, its money, its members, its credentials or its integrations.
 * A migrated role never gets one unless role-map.json says so with a named approver. Checked by key pattern AND by the key's category,
 * so a key added later under `admin` or `billing` is covered without editing this list.
 */
const PATTERNS: RegExp[] = [
  /^billing\./,
  /^paygw\./,
  /^admin\./,
  /^org\./,
  /^bsp\.billing\./,
  /^api\.keys\./,
  /^aiadm\.keys\./,
  /^partner\./,
  /^plan\.subscription\.manage$/,
  /^webhooks\.manage$/,
  /^inbox\.integration\.manage$/,
  /^inbox\.channel\.manage$/,
  /^auth\.branding\.update$/,
  /^market\.apps\.manage$/,
  /^market\.apps\.install$/,
  /^storage\.files\.manage$/,
  /^crm\.activity_types\.manage$/,
  /^appointments\.(channels|templates)\.manage$/,
  /^wallet\.[a-z_.]*(topup|adjust|manage)/,
];
const CATEGORIES = new Set(['admin']);

export function isAdminClassKey(key: string, category?: string | null): boolean {
  return (category != null && CATEGORIES.has(category)) || PATTERNS.some((re) => re.test(key));
}
