import { describe, expect, it, vi } from 'vitest';
import { LEAD_FIRST_REPLY_REASONS, LEAD_FIRST_REPLY_STATUSES } from '@crm/contracts';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { opsKeys } from '../api-ops';
import { emptyDraft, emptySpeed, type SourceDraft } from '../lib/draft';
import { ID } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/lead-sources',
  useSearchParams: () => new URLSearchParams(),
}));

import { FirstReply } from './first-reply';
import { DefaultsFields } from './source-fields';

/**
 * The first-message setting and the line that says where a lead's first message stands, rendered with the real English and Arabic
 * messages: complete text (a missing key throws), the right inputs for each channel, and nothing that offers a way past the consent rules.
 */

const LOCALES = ['en', 'ar'] as const;

const draft = (speed: Partial<SourceDraft['speed']> = {}): SourceDraft => ({
  ...emptyDraft(),
  speed: { ...emptySpeed(), ...speed },
});

const options = {
  whatsapp: {
    templates: [{ id: ID(40), name: 'welcome', preview: 'Hi {{1}}, thanks for asking.' }],
    senders: [],
  },
  sms: {
    templates: [{ id: ID(41), name: 'sms_welcome', preview: 'Hi, we got your enquiry' }],
    senders: [{ id: ID(51), label: 'Sales SMS' }],
  },
  email: {
    templates: [{ id: ID(42), name: 'Welcome mail', preview: 'Welcome aboard' }],
    senders: [{ id: ID(52), label: 'sales@acme.test' }],
  },
} as const;

const seeds = (['whatsapp', 'sms', 'email'] as const).map(
  (c) => [opsKeys.speedOptions(c), options[c]] as const,
);

const html = (
  d: SourceDraft,
  extra: {
    locale?: 'en' | 'ar';
    problems?: Record<string, { key: string; values?: Record<string, number> }>;
  } = {},
) =>
  renderAccount(
    <DefaultsFields draft={d} set={() => undefined} problems={extra.problems ?? {}} server={{}} />,
    { locale: extra.locale ?? 'en', seed: [...seeds] },
  );

describe('the first-message setting', () => {
  for (const locale of LOCALES) {
    it(`is off by default and shows only its switch in ${locale}`, () => {
      const out = html(draft(), { locale });
      expect(out).toContain('data-testid="speed-to-lead"');
      expect(out).toContain('id="ls-speed-on"');
      expect(out).not.toContain('id="ls-speed-channel"');
      expect(out).not.toContain('id="ls-speed-template"');
    });
  }

  it('switched on for WhatsApp it asks for a template, a delay and the business hours, and has no sender to pick', () => {
    const out = html(draft({ enabled: true, channel: 'whatsapp' }));
    expect(out).toContain('id="ls-speed-channel"');
    expect(out).toContain('WhatsApp template');
    expect(out).toContain('id="ls-speed-template"');
    expect(out).toContain('welcome: Hi {{1}}, thanks for asking.');
    expect(out).toContain('id="ls-speed-delay"');
    expect(out).toContain('id="ls-speed-hours"');
    expect(out).not.toContain('id="ls-speed-sender"');
    // consent is never assumed, and the screen says so
    expect(out).toContain('Consent is never assumed');
  });

  it.each([
    ['sms', 'sms_welcome', 'Sales SMS'],
    ['email', 'Welcome mail', 'sales@acme.test'],
  ] as const)('for %s it lists that channel templates and senders', (channel, template, sender) => {
    const out = html(draft({ enabled: true, channel }));
    expect(out).toContain('id="ls-speed-sender"');
    expect(out).toContain(template);
    expect(out).toContain(sender);
  });

  it('shows the problems under their own inputs', () => {
    const out = html(draft({ enabled: true, templateId: '', delay: 'x' }), {
      problems: {
        'defaults.speedToLead.templateId': { key: 'speedTemplateRequired' },
        'defaults.speedToLead.delayMinutes': { key: 'speedDelayRange', values: { max: 60 } },
      },
    });
    expect(out).toContain('Choose the template to send.');
    expect(out).toContain('Enter whole minutes from 0 to');
  });

  it('keeps a saved template that the list no longer offers visible instead of silently dropping it', () => {
    const out = html(draft({ enabled: true, templateId: ID(99) }));
    expect(out).toContain('The saved template is no longer available');
  });

  for (const locale of LOCALES) {
    it(`renders every channel completely in ${locale}`, () => {
      for (const channel of ['whatsapp', 'sms', 'email'] as const) {
        expect(() => html(draft({ enabled: true, channel }), { locale })).not.toThrow();
      }
    });
  }
});

describe('where a first message stands', () => {
  const reply = (status: (typeof LEAD_FIRST_REPLY_STATUSES)[number], reason: string | null) => ({
    channel: 'whatsapp' as const,
    status,
    reason,
    dueAt: '2026-10-16T10:00:00.000Z',
    sentAt: status === 'sent' ? '2026-10-16T10:01:00.000Z' : null,
    attempts: 1,
  });

  for (const locale of LOCALES) {
    it(`has text for every status and every reason in ${locale}`, () => {
      for (const status of LEAD_FIRST_REPLY_STATUSES) {
        expect(() =>
          renderAccount(<FirstReply reply={reply(status, null)} />, { locale }),
        ).not.toThrow();
      }
      for (const reason of LEAD_FIRST_REPLY_REASONS) {
        expect(() =>
          renderAccount(<FirstReply reply={reply('held', reason)} />, { locale }),
        ).not.toThrow();
      }
    });
  }

  it('says the channel, the status and the reason, and when it will be tried again', () => {
    const out = renderAccount(<FirstReply reply={reply('held', 'quiet_hours')} />);
    expect(out).toContain('data-status="held"');
    expect(out).toContain('WhatsApp template');
    expect(out).toContain('Held');
    expect(out).toContain('Waiting for quiet hours to end');
    expect(out).toContain('Next try');
  });

  it('a blocked message says why and shows no moment', () => {
    const out = renderAccount(<FirstReply reply={reply('blocked', 'no_consent')} />);
    expect(out).toContain('Blocked');
    expect(out).toContain('No recorded consent');
    expect(out).not.toContain('Next try');
  });

  it('a reason this build does not know is not shown as a code', () => {
    const out = renderAccount(<FirstReply reply={reply('failed', 'brand_new_reason')} />);
    expect(out).toContain('Failed');
    expect(out).not.toContain('brand_new_reason');
  });
});
