import { settingsTile } from '../_registry/settings-types';

/**
 * Company properties: the fields a workspace keeps on every company (the same registry and screen as Contact properties, module
 * `companies`). Companies are a sales-pipeline feature, so the tile is locked on a plan without it. Shown to those who may change the
 * definitions; everyone who may read them (the Agent preset) still sees the properties on the company form and page.
 */
export const settings = [
  settingsTile({
    id: 'company-properties',
    shortcutFrom: ['/companies'],
    section: 'data',
    href: '/company-properties',
    icon: 'catalog',
    order: 20,
    gates: { permission: 'record.company-properties.update', planFeature: 'sales_pipeline' },
  }),
];
