import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { ChannelListResponse, ChannelResponse } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { sendKeys } from '../api/single-send';
import type { RowView } from '../lib/row-view';
import { SingleSendDrawer, type SingleSendTarget } from './single-send-drawer';

const row = (over: Partial<RowView> = {}): RowView => ({
  id: '294dca7c-5806-4548-9035-dcca9befc7b1',
  name: 'Aarav Sharma',
  language: 'English',
  email: 'aarav@example.com',
  phone: '+91 98765 43210',
  memo: '',
  status: '',
  stage: 'qualified',
  ownerId: null,
  companyId: null,
  optedOut: false,
  whatsappOptIn: 'no',
  smsOptIn: 'no',
  emailOptIn: 'no',
  source: '',
  lastActivityAt: null,
  groups: [],
  tags: [],
  attributes: [],
  custom: {},
  createdAt: '2026-03-05T12:00:00.000Z',
  leadScore: null,
  leadScoreSource: null,
  leadScoredAt: null,
  dateOfBirth: null,
  isMinor: false,
  ...over,
});

const channel = (over: Partial<ChannelResponse> = {}): ChannelResponse => ({
  id: 'c1f0e9a0-1234-4a5b-8c9d-abcdef123456',
  kind: 'email',
  name: 'Sales',
  status: 'connected',
  externalId: null,
  displayAddress: 'sales@acme.test',
  capabilities: {
    media: [],
    receipts: [],
    windowHours: null,
    templates: false,
    reactions: false,
    editDelete: false,
    typing: false,
  },
  settings: { metered: true },
  hasCredentials: true,
  credentialHints: {},
  health: null,
  lastError: null,
  webhookUrl: null,
  lastEventAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

function render(target: SingleSendTarget, channels: ChannelResponse[], seed: Seed = []) {
  const channelList: ChannelListResponse = { data: channels };
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <SingleSendDrawer target={target} onClose={() => undefined} />
    </ToastProvider>,
    {
      session: makeSession({ permissions: { 'call.calls.use': 'all' } as never }),
      seed: [[sendKeys.channels, channelList], ...seed],
    },
  );
}

describe('SingleSendDrawer — email', () => {
  it('shows there is no mailbox to send from when none is connected', () => {
    const html = render({ row: row(), channel: 'email' }, [
      channel({ kind: 'whatsapp_cloud', status: 'connected' }),
    ]);
    expect(html).toContain('No mailbox is connected');
  });

  it('auto-selects a single connected mailbox and shows subject and body fields', () => {
    const mailbox = channel();
    const html = render(
      { row: row(), channel: 'email' },
      [mailbox],
      [
        [
          sendKeys.conversation('294dca7c-5806-4548-9035-dcca9befc7b1', mailbox.id),
          { id: 'conv-1' },
        ],
      ],
    );
    expect(html).toContain('sales@acme.test');
    expect(html).toContain('Subject');
    expect(html).toContain('Message');
  });

  it('blocks sending to a contact with no email address', () => {
    const html = render({ row: row({ email: '' }), channel: 'email' }, [channel()]);
    expect(html).toContain('This contact has no email address.');
  });
});

describe('SingleSendDrawer — sms', () => {
  it("offers a live sms: link to open the person's own app for a real number", () => {
    const html = render({ row: row(), channel: 'sms' }, []);
    expect(html).toContain('href="sms:+91 98765 43210"');
    expect(html).not.toContain('Number is hidden for your role.');
  });

  it('disables the link instead of building a dead sms: href for a masked number', () => {
    const html = render({ row: row({ phone: '+xxxxxxxx0025' }), channel: 'sms' }, []);
    expect(html).not.toContain('href="sms:');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Number is hidden for your role.');
  });
});
