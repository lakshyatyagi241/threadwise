import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { KEYS as CAMP_KEYS } from '../api/campaigns';
import { KEYS } from '../wizard/api/wizard';
import type { SenderHidden } from '@crm/contracts';
import { ENTITLEMENTS_KEY } from '@/lib/use-unofficial-whatsapp';
import { html, sender, templates, uuid } from '../wizard/testing';
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
