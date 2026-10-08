import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { pageVisibleTo } from '@/features/admin-console-shell/console-access';
import { CONSOLE_LAYOUT } from '@/features/admin-console-shell/console-layout';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import { nav } from './nav';
import { REPORT_OPERATOR_NAV } from './operator-nav';

describe('Reports in the workspace menu', () => {
  it('is one entry in the Platform group, after Analytics, behind the view-reports permission', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'reports',
      group: 'overview',
      href: '/reports',
      labelKey: 'report-copilot.nav.title',
      gates: { permission: 'dash.reports.read' },
    });
    expect(hasNavIcon(nav[0]!.icon)).toBe(true);
  });

  it('sits next to Analytics: later than it, in the same group', async () => {
    const { nav: dash } = await import('@/features/dashboards-analytics-charts/nav');
    const analytics = dash.find((n) => n.id === 'analytics')!;
    expect(analytics.group).toBe(nav[0]!.group);
    expect(nav[0]!.order!).toBeGreaterThan(analytics.order!);
  });

  it('has its page route in the app', () => {
    const dir = join(__dirname, '../../app/(app)/(report-copilot)/reports');
    expect(readdirSync(dir)).toContain('page.tsx');
  });
});

describe('Reports in the operator console menu', () => {
  it('is merged into the console menu at /admin/reports', () => {
    expect(REPORT_OPERATOR_NAV.map((i) => i.id)).toEqual(['ai-reports']);
    const item = OPERATOR_NAV.find((i) => i.id === 'ai-reports');
    expect(item).toMatchObject({ href: '/admin/reports', labelKey: 'report-copilot.nav.title' });
  });

  it('is in the Reports hub', () => {
    const hub = CONSOLE_LAYOUT.find((h) => h.tabs.includes('ai-reports'));
    expect(hub?.id).toBe('reports');
  });

  it('is shown to a super admin and an auditor, not to support', () => {
    expect(pageVisibleTo('super_admin', 'ai-reports')).toBe(true);
    expect(pageVisibleTo('auditor', 'ai-reports')).toBe(true);
    expect(pageVisibleTo('support', 'ai-reports')).toBe(false);
  });

  it('has its page route in the console', () => {
    const dir = join(__dirname, '../../app/(admin)/(report-copilot)/admin/reports');
    expect(readdirSync(dir)).toContain('page.tsx');
  });
});
