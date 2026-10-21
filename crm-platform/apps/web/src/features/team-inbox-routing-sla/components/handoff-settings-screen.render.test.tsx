import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { HandoffSettings } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { HandoffSettingsScreen } from './handoff-settings-screen';

const base: HandoffSettings = {
  autoAssign: false,
  claimSetsOwner: true,
  ownerMode: 'independent',
  continuityDays: null,
  promptOwnerOnReassign: false,
  notifyQueue: true,
  available: {
    autoAssign: false,
    ownerFirst: false,
    keepInSync: false,
    continuityWindow: false,
    promptOwnerOnReassign: false,
  },
};
let data: HandoffSettings = base;
let can = true;

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (k: string) => (k === 'inbox.routing.manage' ? can : true),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/routing', () => ({
  useHandoffSettings: () => ({ data, isPending: false, isError: false, refetch: vi.fn() }),
  useUpdateHandoffSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

const html = (locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <ToastProvider dismissLabel="Dismiss">
        <HandoffSettingsScreen />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe('HandoffSettingsScreen', () => {
  it('on a basic plan keeps every control visible, locks auto-assignment and shows the upgrade hint', () => {
    data = base;
    const out = html();
    expect(out).toContain('data-testid="handoff-settings"');
    expect(out).toContain('disabled');
    expect(out).toMatch(/upgrade/i);
  });

  it('a plan with routing has no upgrade hint', () => {
    data = {
      ...base,
      autoAssign: true,
      available: {
        autoAssign: true,
        ownerFirst: true,
        keepInSync: true,
        continuityWindow: true,
        promptOwnerOnReassign: true,
      },
    };
    expect(html()).not.toMatch(/upgrade/i);
  });

  it('without the manage right shows the read-only notice', () => {
    data = base;
    can = false;
    const out = html();
    can = true;
    expect(out).toContain(loadMessages('en')['team-inbox-routing-sla'].handoffSettings.readOnly);
  });
});
