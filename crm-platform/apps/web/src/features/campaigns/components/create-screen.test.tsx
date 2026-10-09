import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { KEYS as CAMP_KEYS } from '../api/campaigns';
import { KEYS } from '../wizard/api/wizard';
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

const seeded = (data: ReturnType<typeof sender>[]) => {
  const qc = new QueryClient();
  qc.setQueryData(KEYS.senders, { data });
  qc.setQueryData(KEYS.templates, { data: templates() });
  qc.setQueryData(CAMP_KEYS.builder, {
    templates: [],
    senders: data.map(({ guided: _g, ...s }) => s),
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
