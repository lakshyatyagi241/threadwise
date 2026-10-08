import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { OperatorSessionResponse, SessionResponse } from '@crm/contracts';
import { OperatorProvider } from '@/features/auth-registration-security/platform/operator-context';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { ReportsPage, ReportsView } from './reports-page';
import { html } from './test-utils';

const workspace = (permissions: Record<string, true>, el: ReactElement) => (
  <SessionProvider session={{ permissions } as unknown as SessionResponse}>{el}</SessionProvider>
);
const operator = (role: string, el: ReactElement) => (
  <OperatorProvider
    session={
      { operator: { role }, mfaEnrolmentRequired: false } as unknown as OperatorSessionResponse
    }
  >
    {el}
  </OperatorProvider>
);

describe('ReportsPage gating', () => {
  it('tells a workspace member without the view-reports permission they have no access', () => {
    const out = html(workspace({ 'dash.dashboard.read': true }, <ReportsPage scope="workspace" />));
    expect(out).toContain('You do not have access to reports.');
    expect(out).not.toContain('Numbers to use');
  });

  it('opens straight onto the page for a member who can read reports: title, description, window selector, no button to open it', () => {
    const out = html(workspace({ 'dash.reports.read': true }, <ReportsPage scope="workspace" />));
    expect(out).toContain('<h1');
    expect(out).toContain('Reports');
    expect(out).toContain('your workspace');
    expect(out).toContain('Numbers to use');
    for (const w of ['Last 7 days', 'Last 30 days', 'Last 90 days']) expect(out).toContain(w);
    expect(out).not.toContain('Open assistant');
    expect(out).not.toContain('You do not have access');
  });

  it('shows the operator page to a super admin and an auditor, and the no-access note to support', () => {
    for (const role of ['super_admin', 'auditor']) {
      const out = html(operator(role, <ReportsPage scope="platform" />));
      expect(out).toContain('the platform');
      expect(out).toContain('Numbers to use');
    }
    expect(html(operator('support', <ReportsPage scope="platform" />))).toContain(
      'You do not have access to reports.',
    );
  });
});

describe('ReportsView', () => {
  it('shows a skeleton of the page while the assistant downloads, never the chat itself', () => {
    const out = html(
      <ReportsView scope="workspace" access={{ canRead: true, canManage: false }} />,
    );
    expect(out).toContain('data-testid="reports-skeleton"');
    expect(out).not.toContain('data-copilotkit');
  });

  it('shows no skeleton and no selector without read access', () => {
    const out = html(
      <ReportsView scope="platform" access={{ canRead: false, canManage: false }} />,
    );
    expect(out).not.toContain('reports-skeleton');
    expect(out).toContain('You do not have access to reports.');
  });
});
