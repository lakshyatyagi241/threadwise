import { describe, expect, it, vi } from 'vitest';
import type { EmailTemplate } from '@crm/contracts';
import { hasNavIcon } from '@/components/shell/nav-icons';
import { render } from '@/features/channel-email/components/render-utils';
import { PLANNED_NAV } from '@/features/_registry/planned';
import { nav } from '../nav';
import { EmailTemplatePicker } from './template-picker';
import { TemplateRow } from './template-row';
import { VariablePicker } from './variable-picker';

let perms: Record<string, boolean> = { 'mail.templates.read': true };
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (key: string) => perms[key] === true,
  useSession: () => ({ user: { id: 'u1' }, permissions: perms }),
}));

const template = (over: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: '9a6f1a7e-3c1d-4d6e-9a41-6b1c2d3e4f99',
  name: 'Welcome',
  subject: 'Hi {{first_name}}',
  bodyHtml: '<p>Hello {{first_name}}</p><script>steal()</script>',
  bodyText: 'Hello {{first_name}}',
  category: 'Onboarding',
  purpose: 'general',
  scope: 'shared',
  status: 'active',
  variables: ['first_name'],
  usedCount: 3,
  lastUsedAt: '2026-02-03T10:00:00.000Z',
  createdByName: 'Sam Rivera',
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const row = (t: EmailTemplate) =>
  render(
    <ul>
      <TemplateRow
        template={t}
        busy={false}
        onEdit={() => undefined}
        onToggleArchive={() => undefined}
        onDelete={() => undefined}
      />
    </ul>,
  );

describe('the menu entry', () => {
  it('is the CRM entry after Companies (70), gated by the read permission and the email add-on', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'email-templates',
      group: 'audience',
      href: '/email-templates',
      order: 80,
      gates: { permission: 'mail.templates.read', planFeature: 'email_channel' },
    });
    expect(hasNavIcon(nav[0]!.icon)).toBe(true);
  });

  it('replaces the planned "Soon" entry', () => {
    expect(PLANNED_NAV.some((i) => i.id === 'email-templates')).toBe(false);
    expect(PLANNED_NAV.some((i) => i.href === '/email-templates')).toBe(false);
  });
});

describe('a row of the library', () => {
  it('shows the name, badges, subject, use and the variables it needs', () => {
    const html = row(template({ purpose: 'marketing' }));
    expect(html).toContain('Welcome');
    expect(html).toContain('Shared');
    expect(html).toContain('Marketing');
    expect(html).toContain('Onboarding');
    expect(html).toContain('Hi {{first_name}}');
    expect(html).toContain('Used 3 times');
    expect(html).toContain('Last used');
    expect(html).toContain('By Sam Rivera');
    expect(html).toContain('{{first_name}}');
  });

  it('offers edit, archive and delete only to someone who may change it', () => {
    const editable = row(template());
    expect(editable).toContain('email-template-edit');
    expect(editable).toContain('email-template-delete');
    const readOnly = row(template({ canEdit: false }));
    expect(readOnly).not.toContain('email-template-edit');
    expect(readOnly).not.toContain('email-template-delete');
    expect(readOnly).not.toContain('email-template-archive');
  });

  it('an archived template says so and offers Restore instead of Archive', () => {
    const html = row(template({ status: 'archived' }));
    expect(html).toContain('Archived');
    expect(html).toContain('Restore');
    expect(html).not.toContain('>Archive<');
  });

  it('a template with no subject says the reply keeps its own, a personal one says Mine', () => {
    const html = row(template({ subject: '', scope: 'mine', usedCount: 0, lastUsedAt: null }));
    expect(html).toContain('No subject: the reply keeps its own');
    expect(html).toContain('Mine');
    expect(html).toContain('Never used');
  });

  it('shows names as text, never as markup', () => {
    const html = row(template({ name: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the variable picker', () => {
  it('offers contact, agent and workspace variables and no device variable', () => {
    const html = render(<VariablePicker onInsert={() => undefined} />);
    for (const key of ['first_name', 'email', 'agent_name', 'workspace_name', 'today']) {
      expect(html, key).toContain(`email-template-variable-${key}`);
    }
    expect(html).not.toContain('device_name');
    expect(html).toContain('Contact');
    expect(html).toContain('Workspace');
  });
});

describe('the composer picker', () => {
  const picker = (applied: { name: string; marketing: boolean } | null = null) =>
    render(
      <EmailTemplatePicker
        conversationId="5d2c7a10-1b2c-4e3d-8f4a-0a1b2c3d4e5f"
        hasDraft={false}
        applied={applied}
        onApply={() => undefined}
        onForget={() => undefined}
      />,
    );

  it('is a Templates button for someone who may read templates', () => {
    expect(picker()).toContain('email-template-picker-button');
  });

  it('is not there without the permission', () => {
    perms = {};
    try {
      expect(picker()).not.toContain('email-template-picker');
    } finally {
      perms = { 'mail.templates.read': true };
    }
  });

  it('names the template in use, offers to stop, and warns that marketing mail carries the unsubscribe link', () => {
    const html = picker({ name: 'Newsletter', marketing: true });
    expect(html).toContain('Using the template &quot;Newsletter&quot;');
    expect(html).toContain('email-template-forget');
    expect(html).toContain('it goes through your consent rules and carries an unsubscribe link');
    expect(picker({ name: 'Plain', marketing: false })).not.toContain('email-template-marketing');
  });
});
