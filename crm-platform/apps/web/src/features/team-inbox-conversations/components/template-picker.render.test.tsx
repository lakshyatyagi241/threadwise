import { describe, expect, it, vi } from 'vitest';
import type { InboxTemplateOption } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { PhonePreview, TemplatePicker } from './template-picker';

const tpl = (over: Partial<InboxTemplateOption> = {}): InboxTemplateOption =>
  ({
    id: 't1',
    name: 'starter',
    language: 'en',
    category: 'UTILITY',
    header: 'Case update',
    body: 'Hi {{1}}, your case is on {{2}}.',
    footer: 'Reply STOP to opt out',
    buttons: ['Click Here'],
    slots: [
      { key: '1', label: 'Name', example: null },
      { key: '2', label: 'Date', example: null },
    ],
    sendable: true,
    reason: null,
    ...over,
  }) as InboxTemplateOption;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('../api/hooks', () => ({
  useConversationTemplates: () => ({
    isPending: false,
    isError: false,
    data: { data: [tpl(), tpl({ id: 't2', name: 'second' })], hasMore: false },
    refetch: () => undefined,
  }),
}));

describe('the phone beside the template list', () => {
  it('shows the customer, the template with the typed values, the footer and the buttons', () => {
    const out = renderIntl(
      <PhonePreview template={tpl()} values={{ '1': 'Mayuri' }} contactName="Mayuri Jadiyar" />,
    );
    expect(out).toContain('Mayuri Jadiyar');
    expect(out).toContain('Case update');
    expect(out).toContain('Hi Mayuri, your case is on {{2}}.');
    expect(out).toContain('Reply STOP to opt out');
    expect(out).toContain('Click Here');
    expect(out).toContain('data-testid="inbox-template-preview"');
  });

  it('asks to point at a template when none is picked, and names the customer "Customer" without a name', () => {
    const out = renderIntl(<PhonePreview template={null} values={{}} />);
    expect(out).not.toContain('inbox-template-preview');
    expect(out).toContain('Point at a template');
    expect(out).toContain('Customer');
  });
});

describe('the template dialog', () => {
  it('lists the templates and the phone side by side', () => {
    const out = renderIntl(
      <ToastProvider>
        <TemplatePicker
          conversationId="c1"
          open
          onClose={() => undefined}
          onSend={async () => undefined}
        />
      </ToastProvider>,
    );
    expect(out).toContain('data-testid="inbox-template-list"');
    expect(out).toContain('data-testid="inbox-template-starter"');
    expect(out).toContain('data-testid="inbox-template-second"');
    expect(out).toContain('Point at a template');
    // The Android and iPhone switch, and a Send button that names the customer.
    expect(out).toContain('data-device="android"');
    expect(out).toContain('data-device="ios"');
    expect(out).toContain('Send to Customer');
    // Create a template, and edit or duplicate one from its row.
    expect(out).toContain('href="/templates/new"');
    expect(out).toContain('data-testid="inbox-template-actions-starter"');
    expect(out).toContain('Android');
    expect(out).toContain('iPhone');
  });

  it('draws the phone as an iPhone or an Android', () => {
    const ios = renderIntl(<PhonePreview template={tpl()} values={{}} device="ios" />);
    const android = renderIntl(<PhonePreview template={tpl()} values={{}} device="android" />);
    expect(ios).toContain('aside aria-label');
    expect(ios).toContain('data-device="ios"');
    expect(android).toContain('data-device="android"');
    expect(ios).not.toEqual(android);
  });
});
