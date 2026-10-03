import { createElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { securityPolicySchema, type SecurityOverviewResponse } from '@crm/contracts';
import { policyToDraft } from '../lib/policy-draft';
import { renderWithMessages, type RenderOptions } from '../render-test-utils';
import { DangerPanel } from './danger-panel';
import { PolicyFormProvider } from './policy-form';
import { AbusePanel, ApiPanel, DevicesPanel, LoginPanel, WhatsappPanel } from './policy-panels';
import { SECURITY_QUERY_KEY, SecurityCenter } from './security-center';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/security',
  useSearchParams: () => new URLSearchParams(),
}));

const policy = securityPolicySchema.parse({});
const AT = '2026-10-01T10:00:00.000Z';

const overview: SecurityOverviewResponse = {
  appName: 'Acme',
  policy,
  emergencyHalt: false,
  kpis: {
    score: 80,
    openRisks: 2,
    highPriorityRisks: 1,
    blockedAttempts24h: 3,
    warnings24h: 1,
    operatorMfa: { enrolled: 1, total: 2 },
    webhookFailurePct: 2.5,
  },
  risks: [
    {
      severity: 'high',
      signal: 'auth.lockout',
      detail: 'ann@example.com',
      workspace: 'Acme Ltd',
      scope: 'workspace',
      actor: 'Ann Lee',
      actorKind: 'user',
      at: AT,
    },
    {
      severity: 'medium',
      signal: 'platform.access.blocked_by_ip',
      detail: 'platform.access.blocked_by_ip',
      workspace: null,
      scope: 'platform',
      actor: 'System',
      actorKind: 'system',
      at: AT,
    },
  ],
  coverage: [
    { key: 'admin_access', percent: 75, enabled: 3, total: 4 },
    { key: 'send_abuse', percent: 0, enabled: 0, total: 5 },
    { key: 'api_hardening', percent: 50, enabled: 1, total: 2 },
    { key: 'incident_readiness', percent: 100, enabled: 2, total: 2 },
  ],
  enforcement: [
    {
      key: 'Idle timeout',
      controls: ['sessionTimeoutMinutes'],
      consumer: 'Session guard',
      status: 'enforced',
    },
  ],
  yourIp: '203.0.113.9',
};

const center = (over: Partial<SecurityOverviewResponse> = {}, options: RenderOptions = {}) =>
  renderWithMessages(createElement(SecurityCenter), {
    ...options,
    seed: [[SECURITY_QUERY_KEY, { ...overview, ...over }]],
  });

/** A panel inside the policy form, the way the Security Center mounts it. */
const panel = (
  element: ReactElement,
  options: RenderOptions & { readOnly?: boolean; ov?: SecurityOverviewResponse } = {},
) =>
  renderWithMessages(
    createElement(
      PolicyFormProvider,
      {
        value: {
          base: policy,
          draft: policyToDraft(policy),
          setField: () => undefined,
          readOnly: options.readOnly ?? false,
          matrix: overview.enforcement,
          yourIp: overview.yourIp,
          errors: {},
        },
      },
      element,
    ),
    options,
  );

describe('Security Center summary', () => {
  it('lists the risks as a table with the five reference columns', () => {
    const html = center();
    expect(html).toContain('<table');
    for (const col of ['Severity', 'Signal', 'Workspace', 'Owner', 'Action'])
      expect(html).toMatch(new RegExp(`<th[^>]*>${col}</th>`));
  });

  it('scrolls the table inside a positioned wrapper, so screen-reader-only text cannot widen the page', () => {
    expect(center()).toContain('class="relative overflow-x-auto"');
  });

  it('shows workspace, owner name and an Inspect link filtered to the signal', () => {
    const html = center();
    expect(html).toContain('Acme Ltd');
    expect(html).toContain('Ann Lee');
    expect(html).toContain('href="/admin/security/events?event=auth.lockout"');
    expect(html).toContain('href="/admin/security/events?status=failure"');
  });

  it('reads a platform-level event as "<app> Platform" owned by System', () => {
    const html = center();
    expect(html).toContain('Acme Platform');
    expect(html).toMatch(/>System</);
  });

  it('prints the detail line only when it says more than the signal does', () => {
    const html = center();
    expect(html).toContain('title="ann@example.com"');
    expect(html).not.toContain('title="platform.access.blocked_by_ip"');
  });

  it('tints a high row red and a medium row amber', () => {
    const html = center();
    expect(html).toContain('bg-danger/5');
    expect(html).toContain('bg-warning/5');
  });

  it('shows the all-clear text, not an empty table body, when there are no risks', () => {
    const html = center({ risks: [] });
    expect(html).toContain('All clear. No failures or warnings in the last 7 days.');
    expect(html).not.toContain('Inspect');
  });

  it('falls back to the console brand when the API sends no app name', () => {
    expect(center({ appName: '  ' })).toContain('CRM Platform');
  });

  it('writes each coverage bucket as percent and counts', () => {
    const html = center();
    expect(html).toContain('75% (3/4)');
    expect(html).toContain('0% (0/5)');
    expect(html).toContain('100% (2/2)');
  });

  it('outlines the open-risks and warnings tiles only when there is something to see', () => {
    const tiles = (html: string) => html.slice(html.indexOf('<dl'), html.indexOf('</dl>'));
    const lit = tiles(center());
    expect(lit).toContain('border-danger/40');
    expect(lit).toContain('border-warning/40');
    const calm = tiles(center({ kpis: { ...overview.kpis, openRisks: 0, warnings24h: 0 } }));
    expect(calm).not.toContain('border-danger/40');
    expect(calm).not.toContain('border-warning/40');
    expect(calm).toContain('border-success/50');
  });

  it('has an inert search box with a name and a keyboard hint, outside the form', () => {
    const html = center();
    expect(html).toContain('aria-label="Search security rules, IPs and actors"');
    expect(html).toContain('Cmd K');
    expect(html.indexOf('type="search"')).toBeLessThan(html.indexOf('<form'));
  });

  it('shows the halted banner and the resume action when sends are halted', () => {
    const html = center({ emergencyHalt: true });
    expect(html).toContain('Emergency stop is on');
    expect(html).toContain('currently halted');
  });

  it('tells a support operator that the policy is read-only', () => {
    expect(center({}, { role: 'support' })).toContain(
      'Only super admins can change these settings',
    );
  });

  it('renders in Arabic with every message present', () => {
    expect(center({}, { locale: 'ar' })).toContain('مركز الأمان');
  });
});

describe('Security Center tabs', () => {
  it('shows the new-password rules as a row of short switches', () => {
    const html = panel(createElement(LoginPanel));
    for (const label of ['Uppercase', 'Number', 'Symbol']) expect(html).toContain(`>${label}<`);
    expect(html).toContain('2xl:grid-cols-4');
  });

  it('keeps the numeric ranges the reference form states', () => {
    const html = panel(createElement(LoginPanel));
    expect(html).toMatch(/id="policy-sessionTimeoutMinutes"[^>]*min="5"[^>]*max="1440"/);
    expect(html).toMatch(/id="policy-lockoutAfterFailures"[^>]*min="1"[^>]*max="50"/);
    expect(html).toMatch(/id="policy-passwordMinLength"[^>]*min="6"[^>]*max="128"/);
  });

  it('puts the guardrail mode beside its heading and explains all three modes', () => {
    const html = panel(createElement(WhatsappPanel));
    expect(html).toContain('id="policy-waGuardrailsMode"');
    for (const mode of ['Off (no checks)', 'Monitor (log only)', 'Enforce (block)'])
      expect(html).toContain(mode);
    expect(html).toContain('href="/admin/workspaces"');
    expect(html).toContain('View workspaces');
  });

  it('offers the keyword list with its total-length hint', () => {
    const html = panel(createElement(AbusePanel));
    expect(html).toContain('id="policy-abuseBlockKeywordList"');
    expect(html).toContain('Up to 5,000 characters in all');
  });

  it('shows the allowlist card with the caller address on the API tab', () => {
    const html = panel(createElement(ApiPanel));
    expect(html).toContain('203.0.113.9');
    expect(html).toContain('Add my IP');
  });

  it('lists the device, alert and retention controls', () => {
    const html = panel(createElement(DevicesPanel));
    for (const id of [
      'policy-deviceTrustRequired',
      'policy-maxConcurrentSessions',
      'policy-auditLogRetentionDays',
    ])
      expect(html).toContain(`id="${id}"`);
  });

  it('links the danger zone to the security audit trail and stresses the kill switch', () => {
    const html = renderWithMessages(
      createElement(DangerPanel, { overview, onAction: () => undefined }),
    );
    expect(html).toContain('href="/admin/security/events?q=platform.security"');
    expect(html).toContain('View security audit trail');
    expect(html).toContain('font-bold');
  });

  it('disables the danger actions for support and names the role', () => {
    const html = renderWithMessages(
      createElement(DangerPanel, { overview, onAction: () => undefined }),
      { role: 'support' },
    );
    expect(html).toContain('These actions are for super admins only. Your role is Support.');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });

  it.each([
    ['login', LoginPanel],
    ['whatsapp', WhatsappPanel],
    ['abuse', AbusePanel],
    ['api', ApiPanel],
    ['devices', DevicesPanel],
  ] as const)('renders the %s tab in Arabic with every message present', (_name, Panel) => {
    expect(panel(createElement(Panel), { locale: 'ar' })).toContain('<fieldset');
  });

  it('renders the danger tab in Arabic with every message present', () => {
    const html = renderWithMessages(
      createElement(DangerPanel, { overview, onAction: () => undefined }),
      { locale: 'ar' },
    );
    expect(html).toContain('platform.security.policy_updated');
  });
});
