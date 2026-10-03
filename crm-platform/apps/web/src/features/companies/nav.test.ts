import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { PLANNED_NAV } from '../_registry/planned';
import { nav } from './nav';

describe('companies nav', () => {
  it('is one CRM entry between Tasks (60) and Email templates (80), gated by the read permission and the sales pipeline', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'companies',
      group: 'audience',
      href: '/companies',
      order: 70,
      gates: { permission: 'record.companies.read', planFeature: 'sales_pipeline' },
    });
    expect(hasNavIcon(nav[0]!.icon)).toBe(true);
  });

  it('replaces the planned "Soon" entry: it is not listed there any more', () => {
    expect(PLANNED_NAV.some((i) => i.id === 'companies')).toBe(false);
    expect(PLANNED_NAV.some((i) => i.href === '/companies')).toBe(false);
  });
});
