import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { member } from '../lib/fixtures';
import { readMessages } from '../lib/test-support';
import { MemberDetailsDialog } from './member-details-dialog';

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useSession: () => ({ org: { timezone: 'Asia/Kolkata' } }),
}));

const html = (m: ReturnType<typeof member> | null) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <MemberDetailsDialog member={m} onClose={() => undefined} onSaved={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

describe('MemberDetailsDialog', () => {
  it('draws nothing while no member is chosen', () => {
    expect(html(null)).not.toContain('name="phone"');
  });

  it('shows the stored phone and limit, and the last login read only in the workspace time zone', () => {
    const out = html(
      member(2, 'agent', {
        phone: '+919876543210',
        chatLimit: 5,
        lastLoginAt: '2026-10-02T12:00:00.000Z',
      }),
    );
    expect(out).toContain('Change member');
    expect(out).toMatch(/name="phone"[^>]*value="\+919876543210"/);
    expect(out).toMatch(/name="chatLimit"[^>]*value="5"/);
    expect(out).toMatch(
      /readOnly=""[^>]*value="Oct 2, 2026, 5:30 PM"|value="Oct 2, 2026, 5:30 PM"[^>]*readOnly=""/,
    );
  });

  it('starts an empty limit blank (no limit) and says the member never signed in', () => {
    const out = html(member(3, 'agent'));
    expect(out).toMatch(/name="chatLimit"[^>]*value=""/);
    expect(out).toContain('Has not signed in yet');
  });
});
