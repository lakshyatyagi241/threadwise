import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { KEYS as CAMP_KEYS } from '../api/campaigns';
import { KEYS } from '../wizard/api/wizard';
import type { SenderHidden } from '@crm/contracts';
import { ENTITLEMENTS_KEY } from '@/lib/use-unofficial-whatsapp';
import { html, previousSends, sender, templates, uuid } from '../wizard/testing';
import { EMPTY_FORM, type BuilderForm } from '../lib/builder-model';
import { StepCompose } from './builder/step-compose';
import { StepRecipients } from './builder/step-recipients';
import { StepReview } from './builder/step-review';
import { StepSchedule } from './builder/step-schedule';
import { LivePreview } from './builder/live-preview';
import { CreateScreen } from './create-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns/create',
  useSearchParams: () => new URLSearchParams(),
}));

const meta = sender({ key: `waba:${uuid(31)}`, label: 'Acme Support', isDefault: true });
const restricted = sender({
  key: `waba:${uuid(33)}`,
  label: 'Acme Restricted',
  isDefault: false,
  guided: false,
});
const twilio = sender({
  key: `twilio:${uuid(32)}`,
  label: 'Acme SMS',
  engine: 'twilio',
  engineLabel: 'Twilio',
  isDefault: false,
  guided: false,
});

const seeded = (
  data: ReturnType<typeof sender>[],
  o: { hidden?: SenderHidden[]; features?: string[] | null } = {},
) => {
  const qc = new QueryClient();
  const hidden = o.hidden ?? [];
  // The platform switch's answer (no `unofficial_whatsapp` feature = off); `null` leaves it still loading.
  if (o.features !== null) qc.setQueryData(ENTITLEMENTS_KEY, { features: o.features ?? [] });
  qc.setQueryData(KEYS.senders, { data, hidden });
  qc.setQueryData(KEYS.templates, { data: templates() });
  qc.setQueryData(CAMP_KEYS.builder, {
    templates: [],
    senders: data.map(({ guided: _g, ...s }) => s),
    hidden,
    groups: [],
    tags: [],
    segments: [],
    flows: [],
    previousSends: [],
    requiresApprovedTemplates: true,
  });
  return qc;
};

describe('Campaigns, Create: one screen, the number is the switch', () => {
  it('opens straight into the guided flow when the default number is a verified Meta number', () => {
    const out = html(<CreateScreen sender="" draft="" />, { qc: seeded([meta, twilio]) });
    // The campaign builder's own page (its stepper, header and preview), with the broadcast sections: no type cards, no A/B, no AI.
    expect(out).toContain('Create new WhatsApp');
    expect(out).toContain('Campaign steps');
    expect(out).toContain('id="camp-sender"');
    expect(out).toContain('Acme Support');
    // Nothing the classic Setup has is gone: the type cards (a custom message and a flow disabled, with the Cloud API reason) and A/B.
    expect(out).toContain('Campaign type');
    expect(out).toContain('Custom message');
    expect(out).toContain('Flow builder');
    expect(out).toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>)[\s\S])*Custom message/);
    expect(out).toContain('only an approved template can be sent from a campaign');
    expect(out).toContain('Enable A/B test');
    expect(out).not.toContain('Build with AI');
    expect(out).not.toContain('Step 1 of 4');
    // Back and Next are in the header (with Save draft), not in a bottom bar: the classic builder's Previous is not there.
    expect(out).toMatch(/<header[\s\S]*>Back<[\s\S]*>Next<[\s\S]*<\/header>/);
    expect(out).not.toContain('>Previous<');
  });

  it('opens the number given in the address', () => {
    const out = html(<CreateScreen sender={twilio.key} draft="" />, { qc: seeded([meta, twilio]) });
    expect(out).toContain('id="camp-sender"');
    expect(out).toContain('Campaign type');
    expect(out).toContain('Enable A/B test');
  });

  it('keeps a Meta number that is not verified on the classic builder, with the reason', () => {
    const out = html(<CreateScreen sender={restricted.key} draft="" />, {
      qc: seeded([restricted, twilio]),
    });
    expect(out).not.toContain('Step 1 of 4');
    expect(out).toContain(
      'Not verified yet: the guided flow is available once the number is verified.',
    );
  });

  it('shows no access without the create permission', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([meta]),
      perms: ['camp.campaigns.read'],
    });
    expect(out).toContain('You cannot create campaigns');
  });
});

describe('the default number', () => {
  it('prefers a verified Meta number over another number of the default engine', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([{ ...restricted, isDefault: true }, meta]),
    });
    expect(out).toContain('only an approved template can be sent from a campaign');
  });
});

describe('an empty or still-loading sender list', () => {
  const personal = sender({
    key: `baileys:${uuid(41)}`,
    label: 'Shop phone',
    engine: 'baileys',
    engineLabel: 'Unofficial API',
    isDefault: true,
    guided: false,
  });

  it('waits for the answer on the platform switch instead of opening on an empty list', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([meta], { features: null }),
    });
    expect(out).toContain('role="status"');
    expect(out).not.toContain('id="camp-sender"');
    expect(out).not.toContain('Campaign type');
  });

  it('only a personal number while that engine is off: the builder says so, with the way forward', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([], { hidden: [{ engine: 'baileys', reason: 'unofficial_disabled', count: 1 }] }),
    });
    expect(out).toContain('data-cause="personal_off"');
    expect(out).toContain('Personal numbers are turned off for this workspace');
    expect(out).toContain('A platform administrator can turn it on');
    expect(out).toContain('href="/channels/whatsapp"');
    expect(out).not.toContain('No connected senders');
  });

  it('a personal number the server still lists is hidden here when the switch is off, and the reason is kept', () => {
    const out = html(<CreateScreen sender="" draft="" />, { qc: seeded([personal]) });
    expect(out).toContain('data-cause="personal_off"');
    expect(out).not.toContain('Shop phone');
  });

  it('keeps the personal number when the switch is on', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([personal], { features: ['unofficial_whatsapp'] }),
    });
    expect(out).toContain('Shop phone');
    expect(out).not.toContain('data-cause');
  });

  it('a number that is still connecting sends the person to its status', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([], { hidden: [{ engine: 'waba', reason: 'pending', count: 2 }] }),
    });
    expect(out).toContain('data-cause="pending"');
    expect(out).toContain('2 numbers are still connecting');
    expect(out).toContain('Check the number&#x27;s status');
    expect(out).toContain('href="/channels/whatsapp"');
  });

  it('a failed connection and a disconnected number each have their own message', () => {
    const failed = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([], { hidden: [{ engine: 'waba', reason: 'error', count: 1 }] }),
    });
    expect(failed).toContain('The connection of 1 number failed');
    const gone = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([], { hidden: [{ engine: 'twilio', reason: 'not_connected', count: 1 }] }),
    });
    expect(gone).toContain('1 number is disconnected');
  });

  it('a disconnected personal number links to the personal numbers screen', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([], {
        features: ['unofficial_whatsapp'],
        hidden: [{ engine: 'baileys', reason: 'not_connected', count: 1 }],
      }),
    });
    expect(out).toContain('data-cause="disconnected"');
    expect(out).toContain('href="/devices"');
  });

  it('a workspace with no number at all is told to connect one', () => {
    const out = html(<CreateScreen sender="" draft="" />, { qc: seeded([]) });
    expect(out).toContain('data-cause="none"');
    expect(out).toContain('No WhatsApp number is connected');
    expect(out).toContain('Connect a WhatsApp number');
  });

  it('only numbers the guided flow cannot use: the classic builder opens on the default one, Next is not left blank', () => {
    const out = html(<CreateScreen sender="" draft="" />, {
      qc: seeded([{ ...restricted, isDefault: true }]),
    });
    expect(out).not.toContain('Step 1 of 4');
    expect(out).toMatch(new RegExp(`<option value="${restricted.key}" selected`));
    expect(out).not.toContain('data-cause');
  });
});

describe('an email campaign (a connected mailbox as the sender)', () => {
  const mailKey = `email:${uuid(50)}`;
  const mailbox = {
    key: mailKey,
    label: 'Support inbox',
    phone: 'support@acme.test',
    engine: 'email',
    engineLabel: 'Email',
    isDefault: true,
  };
  const withMailbox = (senders: unknown[] = [mailbox], hidden: SenderHidden[] = []) => {
    const qc = seeded([meta]);
    qc.setQueryData([...CAMP_KEYS.builder, 'email'], {
      templates: [],
      senders,
      hidden,
      groups: [],
      tags: [],
      segments: [],
      flows: [],
      requiresApprovedTemplates: false,
    });
    return qc;
  };
  const mail: BuilderForm = {
    ...EMPTY_FORM,
    type: 'custom',
    name: 'May offer',
    senderKey: mailKey,
    customHeader: 'Your May offer is live',
    customMessage: 'Hi there',
  };
  const noop = () => undefined;

  it('opens the classic builder on the mailbox, never the guided flow, with no type tiles and no A/B test', () => {
    const out = html(<CreateScreen sender={mailKey} draft="" />, { qc: withMailbox() });
    expect(out).toContain('id="camp-sender"');
    expect(out).toContain('Support inbox');
    expect(out).toContain('support@acme.test');
    expect(out).not.toContain('Campaign type');
    expect(out).not.toContain('Use template');
    expect(out).not.toContain('Flow builder');
    expect(out).not.toContain('Enable A/B test');
    expect(out).not.toContain('Step 1 of 4');
    expect(out).toContain('Campaign steps');
  });

  it('without a mailbox the sender box says why and points at the Email page', () => {
    const out = html(<CreateScreen sender={mailKey} draft="" />, {
      qc: withMailbox([], [{ engine: 'email', reason: 'not_connected', count: 1 }]),
    });
    expect(out).toContain('data-cause="disconnected"');
    expect(out).toContain('1 mailbox is disconnected');
    expect(out).toContain('href="/email"');
  });

  it('Compose shows a Subject (150), the body and the unsubscribe note, and no attachment, footer, buttons or opt-out line', () => {
    const out = html(
      <StepCompose
        form={mail}
        patch={noop}
        builder={undefined}
        catalog={undefined}
        engine="email"
        templates={[]}
      />,
    );
    expect(out).toContain('>Subject<');
    expect(out).toContain('Subject line max 150');
    expect(out).toContain('maxLength="150"');
    expect(out).toContain('e.g. Your May offer is live');
    expect(out).toContain('fall back to the campaign name');
    expect(out).toContain('An unsubscribe link is added');
    expect(out).toContain('Your May offer is live');
    expect(out).not.toContain('>Header<');
    expect(out).not.toContain('Attachment');
    expect(out).not.toContain('>Footer<');
    expect(out).not.toContain('>Buttons<');
    expect(out).not.toContain('Variant B');
  });

  it('a WhatsApp custom message keeps its Header, attachment, footer and buttons', () => {
    const out = html(
      <StepCompose
        form={{ ...mail, senderKey: 'baileys:1' }}
        patch={noop}
        builder={undefined}
        catalog={undefined}
        engine="baileys"
        templates={[]}
      />,
    );
    expect(out).toContain('>Header<');
    expect(out).toContain('Attachment');
    expect(out).toContain('>Footer<');
    expect(out).toContain('>Buttons<');
    expect(out).not.toContain('>Subject<');
  });

  it('Schedule keeps send now, scheduled, recurring and the auto-end date, and drops pacing and click tracking', () => {
    const out = html(<StepSchedule form={mail} patch={noop} minDate="2026-10-14" engine="email" />);
    expect(out).toContain('Send now');
    expect(out).toContain('Schedule later');
    expect(out).toContain('Recurring');
    expect(out).toContain('Auto-end date');
    expect(out).not.toContain('Smart Delivery');
    expect(out).not.toContain('camp-batchSize');
    expect(out).not.toContain('camp-dailyLimit');
    expect(out).not.toContain('camp-wstart');
    expect(out).not.toContain('Track link clicks');
    const wa = html(
      <StepSchedule form={mail} patch={noop} minDate="2026-10-14" engine="baileys" />,
    );
    expect(wa).toContain('Smart Delivery');
    expect(wa).toContain('Track link clicks');
  });

  it('Recipients says contacts without an address are skipped, and typed numbers and CSV rows too', () => {
    const lists = {
      tags: [],
      groups: [],
      segments: [],
      contacts: [],
      contactsDenied: false,
      filter: {},
      onFilter: noop,
    };
    const base = {
      form: mail,
      patch: noop,
      lists,
      onSample: noop,
      onCsvTooBig: noop,
      engine: 'email',
    };
    const picked = html(
      <StepRecipients
        {...base}
        mode="audience"
        onMode={noop}
        skipped={{ contacts: 2, numbers: 0, total: 2 }}
      />,
    );
    expect(picked).toContain('Emails go to the address on each contact');
    expect(picked).toContain('2 chosen recipients have no email address and will be skipped.');
    expect(picked).toContain('>Email<');
    const typed = html(<StepRecipients {...base} mode="manual" onMode={noop} />);
    expect(typed).toContain('have no email address, so they are skipped');
    const wa = html(<StepRecipients {...base} engine="baileys" mode="audience" onMode={noop} />);
    expect(wa).not.toContain('Emails go to the address');
    expect(wa).toContain('>Phone<');
  });

  it('Recipients has a Previous sends section with the picker, the estimate, and a hint on edit', () => {
    const [b, c] = previousSends();
    const base = {
      form: {
        ...mail,
        previousSends: {
          sends: [
            { kind: 'broadcast' as const, id: b!.id },
            { kind: 'campaign' as const, id: c!.id },
          ],
          outcome: 'read' as const,
        },
      },
      patch: noop,
      lists: {
        tags: [],
        groups: [],
        segments: [],
        contacts: [],
        contactsDenied: false,
        filter: {},
        onFilter: noop,
      },
      onSample: noop,
      onCsvTooBig: noop,
      engine: 'baileys',
      previousOptions: previousSends(),
    };
    const out = html(<StepRecipients {...base} mode="audience" onMode={noop} />);
    expect(out).toContain('data-testid="builder-previous-sends"');
    expect(out).toContain('Diwali offer');
    expect(out).toContain('Spring win-back');
    expect(out).toContain('Up to 420 people from the previous sends');
    expect(out).not.toContain('data-testid="previous-edit-hint"');
    const edit = html(<StepRecipients {...base} mode="audience" onMode={noop} editing />);
    expect(edit).toContain('data-testid="previous-edit-hint"');
    expect(edit).toContain('is not shown when you edit');
    // the other ways of choosing do not show it
    expect(html(<StepRecipients {...base} mode="manual" onMode={noop} />)).not.toContain(
      'builder-previous-sends',
    );
  });

  it('Review lists the previous sends estimate once any is picked', () => {
    const props = {
      senderLabel: 'Acme',
      scheduleLabel: 'Sending immediately',
      onGo: noop,
      totals: { groups: 0, contacts: 0, numbers: 0, previous: 420, total: 420 },
    };
    const none = html(<StepReview {...props} form={mail} />);
    expect(none).not.toContain('review-previous');
    const picked = html(
      <StepReview
        {...props}
        form={{
          ...mail,
          previousSends: { sends: [{ kind: 'campaign', id: uuid(32) }], outcome: 'all' },
        }}
      />,
    );
    expect(picked).toContain('data-testid="review-previous"');
    expect(picked).toContain('Previous sends (up to)');
  });

  it('the preview is an email card with the sender, the subject and the body', () => {
    const out = html(
      <LivePreview
        form={mail}
        builder={undefined}
        engine="email"
        senderLabel="Support inbox · support@acme.test"
        recipients={3}
        step={2}
        stepCount={5}
      />,
    );
    expect(out).toContain('data-testid="email-preview"');
    expect(out).toContain('Support inbox · support@acme.test');
    expect(out).toContain('Your May offer is live');
    expect(out).toContain('Hi there');
    expect(out).not.toContain('broadcast-preview');
    expect(out).not.toContain('>A/B<');
    // With no subject the campaign name is shown, as the server sends it.
    const named = html(
      <LivePreview
        form={{ ...mail, customHeader: '' }}
        builder={undefined}
        engine="email"
        senderLabel={null}
        recipients={0}
        step={2}
        stepCount={5}
      />,
    );
    expect(named).toContain('May offer');
  });

  it('Review shows the sender address, the subject and the skipped count', () => {
    const out = html(
      <StepReview
        form={mail}
        senderLabel="Support inbox · support@acme.test"
        scheduleLabel="Sending immediately"
        totals={{ groups: 0, contacts: 2, numbers: 1, previous: 0, total: 3 }}
        skipped={{ contacts: 1, numbers: 1, total: 2 }}
        engine="email"
        onGo={noop}
      />,
    );
    expect(out).toContain('>From<');
    expect(out).toContain('support@acme.test');
    expect(out).toContain('Your May offer is live');
    expect(out).toContain('Skipped (no email address)');
    expect(out).not.toContain('>Device<');
  });
});
