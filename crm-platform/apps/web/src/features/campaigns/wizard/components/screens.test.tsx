import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Campaign, WizardBroadcastDetail, WizardDraft } from '@crm/contracts';
import { CampaignCard } from '@/features/campaigns/components/campaign-card';
import { KEYS } from '../api/wizard';
import { defaultRule } from '../lib/schedule';
import {
  audience,
  ALL_PERMISSIONS,
  NOW,
  count,
  credit,
  draftResponse,
  html,
  sources,
  templates,
  uuid,
} from '../testing';
import { BroadcastScreen } from './broadcast-screen';
import { WizardScreen } from './wizard-screen';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns/wizard',
  useSearchParams: () => new URLSearchParams(),
}));

const ID = uuid(100);
const READY_DRAFT: Partial<WizardDraft> = {
  name: 'October offer',
  templateId: uuid(1),
  audience: audience({ groupIds: [uuid(11)] }),
  variables: {
    'body.1': { kind: 'field', field: 'first_name', fallback: null },
    'body.2': { kind: 'fixed', text: 'A-1' },
  },
};

/** A query cache holding what the wizard loads, so a screen renders its loaded state. */
function seeded(d: Partial<WizardDraft>, extra: (qc: QueryClient) => void = () => undefined) {
  const qc = new QueryClient();
  qc.setQueryData(KEYS.draft(ID), draftResponse(d));
  qc.setQueryData(KEYS.templates, { data: templates() });
  qc.setQueryData(KEYS.sources, sources());
  extra(qc);
  return qc;
}

describe('wizard screen: resume', () => {
  it('opens at the step the draft saved', () => {
    const out = html(<WizardScreen draftId={ID} />, { qc: seeded({ ...READY_DRAFT, step: 2 }) });
    expect(out).toContain('Step 2 of 4 - Audience');
    expect(out).toContain('Matching contacts');
    expect(out).toContain('Contact groups');
    expect(out).toContain('<h2 tabindex="-1"');
  });

  it('step 1 is where a new draft starts, with the name empty and Back off', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.templates, { data: templates() });
    const out = html(<WizardScreen />, { qc });
    expect(out).toContain('Step 1 of 4 - Name and template');
    expect(out).toContain('Broadcast name');
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>Back/);
    expect(out).toContain('Create broadcast');
    expect(out).not.toContain('Draft saved');
  });

  it('a saved name and template come back filled, the template previewed', () => {
    const out = html(<WizardScreen draftId={ID} />, { qc: seeded({ ...READY_DRAFT, step: 1 }) });
    expect(out).toContain('value="October offer"');
    expect(out).toContain('data-testid="phone-preview"');
    expect(out).toContain('selected=""');
  });

  it('the stepper lets the person go back to the steps reached, not beyond', () => {
    const out = html(<WizardScreen draftId={ID} />, { qc: seeded({ ...READY_DRAFT, step: 2 }) });
    const nav = out.slice(out.indexOf('<ol'), out.indexOf('</ol>'));
    const buttons = nav.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    expect(buttons.filter((b) => / disabled=""/.test(b))).toHaveLength(2);
  });
});

describe('wizard screen: final button by schedule mode', () => {
  const last = (schedule: WizardDraft['schedule']) =>
    html(<WizardScreen draftId={ID} />, {
      qc: seeded({ ...READY_DRAFT, step: 4, schedule }, (qc) =>
        qc.setQueryData(KEYS.credit(uuid(1), READY_DRAFT.audience!), credit()),
      ),
    });

  it('reads Broadcast now for "now"', () => {
    const out = last({ mode: 'now' });
    expect(out).toContain('Step 4 of 4 - Test and send');
    expect(out).toContain('Broadcast now');
    expect(out).not.toContain('Start recurring');
  });

  it('reads Schedule for a scheduled send', () => {
    const out = last({ mode: 'scheduled', date: '2026-12-01', time: '09:00', timezone: 'UTC' });
    expect(out).toMatch(/<button[^>]*>Schedule<\/button>/);
  });

  it('reads Start recurring for a recurring send, and shows the rule', () => {
    const out = last({ mode: 'recurring', rule: defaultRule('Asia/Kolkata', NOW) });
    expect(out).toMatch(/<button[^>]*>Start recurring<\/button>/);
    expect(out).toContain('data-testid="recurrence-banner"');
  });

  it('has the launch confirm dialog ready with the summary', () => {
    const out = last({ mode: 'now' });
    expect(out).toContain('Broadcast now?');
    expect(out).toContain('>Cancel<');
  });
});

describe('wizard screen: step 3 gating', () => {
  const review = (c: ReturnType<typeof credit>) =>
    html(<WizardScreen draftId={ID} />, {
      qc: seeded({ ...READY_DRAFT, step: 3 }, (qc) => {
        qc.setQueryData(KEYS.credit(uuid(1), READY_DRAFT.audience!), c);
      }),
    });

  it('an insufficient balance blocks Next and says why, in the card and next to the button', () => {
    const out = review(credit({ sufficient: false, shortfallMinor: 1_000 }));
    expect(out).toContain('Insufficient balance');
    expect(out).toContain('Your wallet balance is too low for this broadcast.');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('href="/billing/top-up"');
  });

  it('a covered balance leaves Next open', () => {
    const out = review(credit());
    expect(out).toContain('Your balance covers this broadcast.');
    expect(out).not.toContain('aria-disabled="true"');
  });

  it('the stepper reads step 3 and the wallet is asked for', () => {
    expect(review(credit())).toContain('Step 3 of 4 - Check and variables');
  });
});

describe('wizard screen: access and states', () => {
  it('shows a no-access state without the create permission', () => {
    const out = html(<WizardScreen />, { perms: ['camp.campaigns.read'] });
    expect(out).toContain('You cannot create broadcasts');
    expect(out).not.toContain('Broadcast name');
  });

  it('shows a loading state while the draft loads', () => {
    expect(html(<WizardScreen draftId={ID} />)).toContain('Loading the draft');
  });

  it('a launched draft is read only with a link to the status page', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.draft(ID), draftResponse({}, { status: 'scheduled' }));
    const out = html(<WizardScreen draftId={ID} />, { qc });
    expect(out).toContain('This broadcast was already sent');
    expect(out).toContain(`href="/campaigns/wizard/broadcasts/${ID}"`);
    expect(out).not.toContain('Broadcast name');
    expect(out).not.toContain('Next');
  });
});

describe('status page', () => {
  const retries = {
    enabled: true,
    endDate: '2026-10-20',
    pending: 4,
    nextRetryAt: '2026-10-07T09:00:00.000Z',
    recovered: 7,
    exhausted: 1,
  };
  const detail = (over: Partial<WizardBroadcastDetail> = {}): WizardBroadcastDetail => ({
    id: ID,
    kind: 'series',
    name: 'Weekly digest',
    status: 'active',
    mode: 'recurring',
    templateId: uuid(1),
    templateName: 'order_update',
    nextRunAt: '2026-10-12T03:30:00.000Z',
    lastRunAt: '2026-10-05T03:30:00.000Z',
    runs: 2,
    recipients: 950,
    retries,
    schedule: { mode: 'recurring', rule: { ...defaultRule('Asia/Kolkata', NOW), weekdays: [1] } },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    rowVersion: 2,
    draft: draftResponse().draft,
    runList: [
      {
        id: uuid(70),
        occurrence: 2,
        runAt: '2026-10-05T03:30:00.000Z',
        status: 'completed',
        counts: {
          recipients: 950,
          sent: 940,
          delivered: 900,
          read: 400,
          failed: 10,
          replies: 5,
          clicks: 3,
        } as never,
        retries,
      },
    ],
    ...over,
  });
  const page = (d: WizardBroadcastDetail, perms = ALL_PERMISSIONS) => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.broadcast(ID), d);
    return html(<BroadcastScreen id={ID} />, { qc, perms });
  };

  it('shows the name, status, mode, schedule in words, next run and runs', () => {
    const out = page(detail());
    expect(out).toContain('Weekly digest');
    expect(out).toContain('Active');
    expect(out).toContain('Recurring Broadcast');
    expect(out).toContain('Repeats every week on Monday at 09:00 (Asia/Kolkata)');
    expect(out).toContain('Oct 12, 2026, 9:00 AM'); // shown on the schedule's own clock
    expect(out).toContain('940');
    expect(out).toContain('#2');
  });

  it('links every run to the existing campaign page', () => {
    expect(page(detail())).toContain(`href="/campaigns/${uuid(70)}"`);
  });

  it('summarises the retries: waiting, recovered, gave up, next, end date', () => {
    const out = page(detail());
    expect(out).toContain('Waiting for a retry');
    expect(out).toContain('Delivered by a retry');
    expect(out).toContain('Gave up');
    expect(out).toContain('Retrying until Oct 20, 2026.');
    expect(out).toContain('4 waiting, 7 recovered, 1 gave up');
  });

  it('shows Pause and Cancel for an active series, Resume and Cancel for a paused one', () => {
    const active = page(detail());
    expect(active).toContain('>Pause<');
    expect(active).toContain('Cancel broadcast');
    expect(active).not.toContain('>Resume<');
    const paused = page(detail({ status: 'paused' }));
    expect(paused).toContain('>Resume<');
    expect(paused).not.toContain('>Pause<');
  });

  it('shows no controls for ended work, and hides them without the permission', () => {
    const ended = page(detail({ status: 'ended' }));
    expect(ended).toContain('<div class="flex flex-wrap gap-2"></div>');
    expect(ended).not.toContain('>Pause<');
    const noPerm = page(detail(), ['camp.campaigns.read']);
    expect(noPerm).not.toContain('>Pause<');
    expect(noPerm).toContain('do not have permission to pause, resume or cancel');
  });

  it('a one-off campaign: a single run, no retries', () => {
    const out = page(
      detail({
        kind: 'campaign',
        mode: 'scheduled',
        status: 'scheduled',
        retries: { ...retries, enabled: false },
        schedule: { mode: 'scheduled', date: '2026-10-09', time: '10:30', timezone: 'UTC' },
        runList: [],
      }),
    );
    expect(out).toContain('Sent once on Oct 9, 2026 at 10:30 (UTC).');
    expect(out).toContain('Retries are off for this broadcast.');
    expect(out).toContain('No run has started yet.');
    expect(out).toContain('Cancel broadcast');
  });

  it('has a loading state and a confirm dialog for cancel', () => {
    expect(html(<BroadcastScreen id={ID} />)).toContain('Loading the broadcast');
    const out = page(detail());
    expect(out).toContain('Cancel this broadcast?');
    expect(out).toContain('No further runs will start.');
  });
});

describe('campaign list card', () => {
  const campaign = (over: Partial<Campaign>) =>
    ({
      id: ID,
      name: 'Weekly digest',
      type: 'template',
      status: 'draft',
      abTesting: false,
      wizard: false,
      scheduleType: 'instant',
      sendDate: null,
      sendTime: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      templateName: null,
      counts: { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, replies: 0, clicks: 0 },
      ...over,
    }) as unknown as Campaign;
  const card = (c: Campaign) =>
    html(
      <CampaignCard
        c={c}
        selected={false}
        busy={false}
        canControl
        canUpdate
        canDelete
        canExport
        onSelect={() => undefined}
        onCancel={() => undefined}
        onResume={() => undefined}
        onResend={() => undefined}
        onDelete={() => undefined}
        onExport={() => undefined}
      />,
    );

  it('a wizard draft opens in the wizard', () => {
    const out = card(campaign({ wizard: true }));
    expect(out).toContain(`href="/campaigns/wizard/${ID}"`);
    expect(out).not.toContain(`/campaigns/${ID}/edit`);
  });

  it('a classic draft still opens the classic builder', () => {
    const out = card(campaign({ wizard: false }));
    expect(out).toContain(`href="/campaigns/${ID}/edit"`);
    expect(out).not.toContain('/campaigns/wizard/');
  });

  it('a launched wizard broadcast goes to the campaign page and has no classic edit', () => {
    const out = card(campaign({ wizard: true, status: 'scheduled' }));
    expect(out).toContain(`href="/campaigns/${ID}"`);
    expect(out).not.toContain('/edit');
  });
});

describe('count seeds', () => {
  it('uses the fixtures consistently', () => {
    expect(count().recipients).toBe(950);
  });
});
