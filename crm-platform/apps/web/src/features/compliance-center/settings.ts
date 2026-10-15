import { settingsTile } from '../_registry/settings-types';

/**
 * Compliance center (BL-172 to BL-181, a product extension, no Reference screen): the profiles of the privacy laws a workspace works
 * under, officer contacts, notices and links, the sub-processor list, quiet hours and a checklist. A tile under Security for roles that
 * may read it. Copy lives in `messages/<locale>/settings.json` under `settings.tiles.compliance-center`.
 */
export const settings = [
  settingsTile({
    id: 'compliance-center',
    section: 'security',
    href: '/compliance',
    icon: 'shield',
    order: 10,
    gates: { permission: 'settings.compliance.read' },
  }),
];
