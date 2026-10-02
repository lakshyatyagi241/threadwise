import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { PLANNED_NAV } from '../_registry/planned';
import { nav } from './nav';

describe('sales-docs menu entries', () => {
  it('declare Proposals then Estimates in the Sales group, with drawn icons', () => {
    expect(nav.map((i) => i.id)).toEqual(['proposals', 'estimates']);
    for (const i of nav) {
      expect(i.group).toBe('sales');
      expect(i.href).toBe(`/${i.id}`);
      expect(i.labelKey).toBe(`sales-docs.nav.${i.id}`);
      expect(hasNavIcon(i.icon)).toBe(true);
    }
    expect((nav[0]!.order ?? 0) < (nav[1]!.order ?? 0)).toBe(true);
  });

  it('are no longer planned "Soon" items', () => {
    const planned = new Set(PLANNED_NAV.map((i) => i.id));
    for (const i of nav) expect(planned.has(i.id), i.id).toBe(false);
  });
});
