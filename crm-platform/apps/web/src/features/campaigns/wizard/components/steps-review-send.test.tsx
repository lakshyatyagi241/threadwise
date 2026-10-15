import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { WizardDraft, WizardSchedule } from '@crm/contracts';
import { KEYS } from '../api/wizard';
import { defaultRule } from '../lib/schedule';
import {
  audience,
  NOW,
  count,
  credit,
  draft,
  failed,
  html,
  pending,
  ready,
  sender,
  sources,
  template,
  templates,
  uuid,
} from '../testing';
import { CreditCard } from './credit-card';
import { LaunchDialog } from './launch-dialog';
import { RecurrencePanel } from './recurrence-panel';
import { RetriesCard } from './retries-card';
import { ScheduleCard } from './schedule-card';
import { StepReview } from './step-review';
import { StepSend } from './step-send';
import { TestSendCard } from './test-send-card';
import { VariablesCard } from './variables-card';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns/wizard',
  useSearchParams: () => new URLSearchParams(),
}));

const none = () => undefined;
const withGroup = audience({ groupIds: [uuid(11)] });

describe('credit check', () => {
  const card = (c: Parameters<typeof CreditCard>[0]['credit']) => html(<CreditCard credit={c} />);

  it('shows balance, estimated cost and the breakdown by country', () => {
    const out = card(ready(credit()));
    expect(out).toContain('Credit check');
    expect(out).toContain('Your balance covers this campaign.');
    expect(out).toContain('$500.00');
    expect(out).toContain('$95.00');
    expect(out).toContain('India');
    expect(out).toContain('Unknown country');
    expect(out).toContain('<table');
    expect(out).toContain('Every delivered message is charged to your wallet: 950 messages.');
  });

  it('says what the plan covers in plan mode', () => {
    const out = card(ready(credit({ billingMode: 'plan', chargeableMessages: 40 })));
    expect(out).toContain(
      'Your plan covers the first messages; the wallet pays for 40 messages beyond them.',
    );
  });

  it('says the workspace is not billed instead of what the plan covers', () => {
    const out = card(ready(credit({ platformOwned: true, billingMode: 'plan' })));
    expect(out).toContain('This workspace is not billed for sends');
    expect(out).not.toContain('Your plan covers');
    expect(out).not.toContain('Charged to your wallet');
  });

  it('shows the danger state with the shortfall and a Top up link to the response url', () => {
    const out = card(
      ready(
        credit({ sufficient: false, shortfallMinor: 2_550, topupUrl: '/billing/top-up?need=2550' }),
      ),
    );
    expect(out).toContain('Insufficient balance');
    expect(out).toContain('You are short by $25.50');
    expect(out).toMatch(/<a href="\/billing\/top-up\?need=2550"[^>]*>Top up<\/a>/);
    expect(out).not.toContain('Your balance covers');
  });

  it('has loading and error states (the error does not block, it says the check repeats at launch)', () => {
    expect(card(pending)).toContain('Checking your wallet');
    const bad = card(failed());
    expect(bad).toContain('Could not reach the server');
    expect(bad).toContain('checked again when you start the campaign');
  });
});

describe('variables', () => {
  const card = (over: Partial<Parameters<typeof VariablesCard>[0]> = {}, qc?: QueryClient) =>
    html(
      <VariablesCard
        template={template()}
        variables={{}}
        audience={withGroup}
        properties={[{ key: 'city', label: 'City' }]}
        issues={[]}
        showIssues={false}
        onVariable={none}
        onVariables={none}
        {...over}
      />,
      { qc },
    );

  it('has a row per placeholder with its example, a source selector and the field picker', () => {
    const out = card();
    expect(out).toContain('data-slot="body.1"');
    expect(out).toContain('data-slot="body.2"');
    expect(out).toContain('Example: Asha');
    expect(out).toContain('Contact field');
    expect(out).toContain('Fixed text');
    expect(out).toContain('<optgroup label="Contact fields">');
    expect(out).toContain('<option value="first_name">First name</option>');
    expect(out).toContain('<optgroup label="Custom properties">');
    expect(out).toContain('<option value="city">City</option>');
  });

  it('shows a mapped field with its fallback, and a fixed text row', () => {
    const out = card({
      variables: {
        'body.1': { kind: 'field', field: 'first_name', fallback: 'friend' },
        'body.2': { kind: 'fixed', text: 'A-1042' },
      },
    });
    expect(out).toContain('value="friend"');
    expect(out).toContain('value="A-1042"');
    expect(out.match(/Mapped/g)).toHaveLength(2);
  });

  it('lists the unmapped placeholders after a try', () => {
    const out = card({
      showIssues: true,
      issues: [
        { path: 'variables.body.1', code: 'variable_unmapped' },
        { path: 'variables.body.2', code: 'variable_unmapped' },
      ],
    });
    expect(out).toContain('2 variables are not mapped yet:');
    expect(out).toContain('body.1, body.2');
    expect(out).toContain('Not mapped');
    expect(card()).not.toContain('not mapped yet');
  });

  it('says so when the template has no variables', () => {
    const out = card({ template: template({ slots: [] }) });
    expect(out).toContain('This template has no variables.');
  });

  it('asks for a template when there is none', () => {
    expect(card({ template: null })).toContain('Go back and choose a template first.');
  });

  it('shows sample messages for real contacts and flags empty placeholders', () => {
    const qc = new QueryClient();
    const variables = { 'body.1': { kind: 'field' as const, field: 'first_name', fallback: null } };
    qc.setQueryData(KEYS.preview(uuid(1), { ...withGroup }, variables), {
      slots: template().slots,
      unmapped: ['body.2'],
      samples: [
        {
          contact: { id: uuid(50), name: 'Asha Rao', phone: '+919800000001' },
          header: null,
          body: 'Hi Asha, your order  is on its way.',
          footer: null,
          values: { 'body.1': 'Asha', 'body.2': '' },
          empty: ['body.2'],
        },
      ],
    });
    const out = card({ variables }, qc);
    expect(out).toContain('Sample messages');
    expect(out).toContain('Asha Rao');
    expect(out).toContain('Hi Asha, your order');
    expect(out).toContain('Empty for this contact: body.2');
    expect(card({ variables })).toContain('Loading sample messages');
  });
});

describe('step 3 as a whole', () => {
  const review = (over: Partial<Parameters<typeof StepReview>[0]> = {}, qc?: QueryClient) =>
    html(
      <StepReview
        draft={draft({
          name: 'October offer',
          templateId: uuid(1),
          audience: audience({ groupIds: [uuid(11)], segmentIds: [uuid(21)] }),
          variables: {
            'body.1': { kind: 'field', field: 'first_name', fallback: 'friend' },
            'body.2': { kind: 'fixed', text: 'A-1' },
          },
        })}
        template={template()}
        sender={sender()}
        sources={sources()}
        count={count()}
        credit={ready(credit())}
        properties={[]}
        issues={[]}
        showIssues={false}
        onVariable={none}
        onVariables={none}
        onEdit={none}
        {...over}
      />,
      { qc },
    );

  it('has the three cards and the summary of every value', () => {
    const out = review();
    for (const h of ['Credit check', 'Variables', 'Summary']) expect(out).toContain(h);
    expect(out).toContain('October offer');
    expect(out).toContain('order_update');
    expect(out).toContain('Utility');
    expect(out).toContain('Groups: VIP customers');
    expect(out).toContain('Segments: Active last 30 days');
    expect(out).toContain('950');
    expect(out).toContain('50 skipped (30 opted out, 20 invalid numbers)');
    expect(out).toContain('$95.00');
    expect(out).toContain('is filled from First name, or &quot;friend&quot; when empty');
    expect(out).toContain('is the fixed text &quot;A-1&quot;');
  });

  it('lists the follow-ups in words, naming the template and the flow', () => {
    const followUps = [
      {
        trigger: 'not_read' as const,
        waitMinutes: 120,
        action: { kind: 'template' as const, templateId: uuid(2) },
      },
      {
        trigger: 'replied' as const,
        waitMinutes: 2880,
        action: { kind: 'flow' as const, flowId: uuid(81) },
      },
    ];
    const d = draft({ name: 'October offer', templateId: uuid(1), followUps });
    const out = review({ draft: d, templates: templates() });
    expect(out).toContain('Follow-ups');
    expect(out).toContain('If not read after 2 hours: send summer_sale');
    // The flows are still loading here: a dash instead of a name.
    expect(out).toContain('If they reply within 2 days: start flow -');
    expect(review()).not.toContain('Follow-ups');
  });

  it('has an Edit link per owned value that names what it edits', () => {
    const out = review();
    expect(out).toContain('aria-label="Edit Name"');
    expect(out).toContain('aria-label="Edit Template"');
    expect(out).toContain('aria-label="Edit Audience"');
    expect(out).toContain('aria-label="Edit Recipients"');
  });

  it('writes the conditions in words and flags a deleted group', () => {
    const rules = {
      type: 'group' as const,
      combinator: 'and' as const,
      children: [
        {
          type: 'condition' as const,
          field: 'countryCode',
          operator: 'equals' as const,
          value: '+91',
        },
      ],
    };
    const out = review({
      draft: draft({
        templateId: uuid(1),
        audience: audience({ groupIds: [uuid(99)], allMatching: { search: null, rules } }),
      }),
    });
    expect(out).toContain('(deleted)');
    expect(out).toMatch(/All contacts matching .*\+91/);
  });
});

describe('test send', () => {
  const card = (props: Partial<Parameters<typeof TestSendCard>[0]> = {}) =>
    html(
      <TestSendCard
        draftId={uuid(100)}
        canTest
        ensureSaved={async () => true}
        currency="USD"
        {...props}
      />,
    );

  it('lists exactly the four notes', () => {
    const out = card();
    for (const note of [
      'If multiple recipients, separate the phone numbers by a comma',
      'The tracking will not be enabled',
      'Credits will be deducted according to the number of WhatsApp messages sent for this test',
      'Phone numbers should be in the format +91xxxxxxxxxx,+91xxxxxxxxxx',
    ]) {
      expect(out).toContain(note);
    }
    expect(out.match(/<li>/g)).toHaveLength(4);
    expect(out).toContain('Send a test WhatsApp message');
    expect(out).toContain('Recipient(s)');
  });

  it('keeps Send Test off until the numbers are valid', () => {
    expect(card()).toMatch(/<button[^>]* disabled=""[^>]*>Send Test/);
    expect(card({ initialRecipients: '+919800000001, +919800000002' })).not.toMatch(
      /<button[^>]* disabled=""[^>]*>Send Test/,
    );
    expect(card({ initialRecipients: '+919800000001, +919800000002' })).toContain(
      '2 numbers ready',
    );
  });

  it('says which numbers are invalid, while typing', () => {
    const out = card({ initialRecipients: '+919800000001, 98000, abc' });
    expect(out).toContain('These numbers are not valid: 98000, abc');
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>Send Test/);
    expect(out).toContain('aria-invalid="true"');
  });

  it('allows at most 10 numbers', () => {
    const many = Array.from({ length: 11 }, (_, i) => `+9198000000${String(10 + i)}`).join(',');
    const out = card({ initialRecipients: many });
    expect(out).toContain('A test goes to at most 10 numbers.');
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>Send Test/);
  });

  it('has Reset and Send Test buttons, a recent-tests region, and no results at first', () => {
    const out = card();
    expect(out).toContain('>Reset<');
    expect(out).toContain('Recent tests');
    expect(out).not.toContain('Message sent:');
  });

  it('lists recent tests with their status, error and charge', () => {
    const qc = new QueryClient();
    qc.setQueryData(KEYS.tests(uuid(100)), {
      data: [
        {
          id: uuid(61),
          to: '+919800000001',
          status: 'delivered',
          providerMessageId: 'w1',
          errorCode: null,
          errorMessage: null,
          chargedMinor: 80,
          createdAt: '2026-10-06T07:00:00.000Z',
        },
        {
          id: uuid(62),
          to: '+919800000002',
          status: 'failed',
          providerMessageId: null,
          errorCode: '131026',
          errorMessage: 'Message undeliverable',
          chargedMinor: 0,
          createdAt: '2026-10-06T07:01:00.000Z',
        },
      ],
    });
    const out = html(
      <TestSendCard draftId={uuid(100)} canTest ensureSaved={async () => true} currency="USD" />,
      { qc },
    );
    expect(out).toContain('+919800000001');
    expect(out).toContain('Delivered');
    expect(out).toContain('Charged $0.80');
    expect(out).toContain('Failed');
    expect(out).toContain('Message undeliverable (131026)');
  });

  it('is hidden behind the permission', () => {
    const out = card({ canTest: false });
    expect(out).toContain('do not have permission to send test messages');
    expect(out).not.toContain('Send Test');
  });
});

describe('when to send', () => {
  const sched = (
    schedule: WizardSchedule,
    issues: Parameters<typeof ScheduleCard>[0]['issues'] = [],
  ) =>
    html(
      <ScheduleCard schedule={schedule} zone="Asia/Kolkata" issues={issues} onSchedule={none} />,
    );

  it('offers three radios and the explainer with its three bullets', () => {
    const out = sched({ mode: 'now' });
    expect(out.match(/type="radio"/g)).toHaveLength(3);
    for (const l of ['Send now', 'Schedule campaign', 'Recurring campaign'])
      expect(out).toContain(l);
    expect(out).toContain('What is the difference between now, schedule and recurring campaign?');
    expect(out).toContain('Now: sent right away, once.');
    expect(out).toContain('Schedule: sent once at the date and time you pick.');
    expect(out).toContain(
      'Recurring: sent again and again on the rule, each run to the audience as it is at that time.',
    );
    expect(out).not.toContain('data-picker="date"');
  });

  it('schedule: date, time and a zone select that defaults to the zone it is given', () => {
    const out = sched({
      mode: 'scheduled',
      date: '2026-10-07',
      time: '09:00',
      timezone: 'Asia/Kolkata',
    });
    expect(out).toContain('data-picker="date"');
    expect(out).toContain('data-picker="time"');
    expect(out).toContain('07/10/2026');
    expect(out).toContain('09:00 AM');
    expect(out).toMatch(/<option value="Asia\/Kolkata" selected="">/);
  });

  it('schedule: an inline error when not in the future', () => {
    const out = sched({ mode: 'scheduled', date: '2026-10-05', time: '09:00', timezone: 'UTC' }, [
      { path: 'schedule.date', code: 'schedule_in_past' },
    ]);
    expect(out).toContain('Pick a date and time in the future.');
    expect(out).toContain('aria-invalid="true"');
  });
});

describe('recurring panel', () => {
  const rule = { ...defaultRule('Asia/Kolkata', NOW), weekdays: [1, 3] };
  const panel = (r = rule, issues: Parameters<typeof RecurrencePanel>[0]['issues'] = []) =>
    html(<RecurrencePanel rule={r} issues={issues} onRule={none} />);

  it('says the rule in words, with plurals and the zone', () => {
    const out = panel();
    expect(out).toContain(
      'Repeats every week on Monday and Wednesday at 09:00 (Asia/Kolkata), starting Oct 7, 2026',
    );
    expect(panel({ ...rule, interval: 2 })).toContain('every 2 weeks on Monday and Wednesday');
    expect(panel({ ...rule, frequency: 'daily', interval: 3, weekdays: [] })).toContain(
      'every 3 days at 09:00',
    );
  });

  it('describes the end of the rule', () => {
    expect(panel({ ...rule, ends: { kind: 'on_date', date: '2026-12-31' } })).toContain(
      ', until Dec 31, 2026',
    );
    expect(panel({ ...rule, ends: { kind: 'after', occurrences: 1 } })).toContain(
      ', ending after 1 run',
    );
    expect(panel({ ...rule, ends: { kind: 'after', occurrences: 12 } })).toContain(
      ', ending after 12 runs',
    );
    expect(panel()).not.toContain('until');
  });

  it('weekday toggles are buttons with aria-pressed and full names', () => {
    const out = panel();
    const toggles = out.match(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(7);
    expect(toggles.filter((b) => b.includes('aria-pressed="true"'))).toHaveLength(2);
    expect(out).toContain('aria-label="Monday"');
    expect(out).toContain('aria-label="Sunday"');
    expect(out).toContain('On these days');
  });

  it('monthly: no weekday toggles, a day-of-month hint', () => {
    const out = panel({ ...rule, frequency: 'monthly', weekdays: [], monthDay: 31 });
    expect(out).not.toContain('aria-pressed');
    expect(out).toContain('On the 31st; shorter months use their last day.');
    expect(out).toContain('on the 31st at 09:00');
    expect(panel({ ...rule, frequency: 'monthly', weekdays: [], monthDay: 22 })).toContain(
      'On the 22nd;',
    );
  });

  it('has frequency, repeat-every, ends and time of day controls', () => {
    const out = panel();
    expect(out).toContain('Start date');
    expect(out).toContain('Time of day');
    for (const f of ['Daily', 'Weekly', 'Monthly']) expect(out).toContain(`>${f}</option>`);
    expect(out).toContain('Repeat every');
    expect(out).toContain('>week<');
    for (const e of ['Never', 'On date', 'After a number of runs']) expect(out).toContain(e);
  });

  it('previews the next five runs with the shared recurrence maths', () => {
    const out = panel();
    expect(out).toContain('Next runs');
    const list = out.slice(out.indexOf('<ol'));
    expect(list.match(/<li>/g)).toHaveLength(5);
    expect(list).toContain('Oct 7, 2026, 9:00 AM');
    expect(list).toContain('Oct 12, 2026, 9:00 AM');
  });

  it('stops the preview when the rule ends', () => {
    const out = panel({ ...rule, ends: { kind: 'after', occurrences: 2 } });
    expect(out.slice(out.indexOf('<ol')).match(/<li>/g)).toHaveLength(2);
  });

  it('an invalid rule shows a hint instead of a sentence and no runs', () => {
    const out = panel({ ...rule, interval: 0 }, [
      { path: 'schedule.rule', code: 'recurrence_invalid' },
    ]);
    expect(out).toContain('Complete the highlighted fields to see the rule in words.');
    expect(out).toContain('The repeat settings are not valid.');
    expect(out).not.toContain('<ol');
  });

  it('reads in Arabic with ICU plurals', () => {
    const out = html(
      <RecurrencePanel rule={{ ...rule, interval: 2 }} issues={[]} onRule={none} />,
      { locale: 'ar' },
    );
    expect(out).toContain('كل أسبوعين');
  });
});

describe('retries', () => {
  const card = (
    retries: WizardDraft['retries'],
    issues: Parameters<typeof RetriesCard>[0]['issues'] = [],
  ) => html(<RetriesCard retries={retries} issues={issues} onRetries={none} />);

  it('has a switch and the three-bullet info box', () => {
    const out = card({ enabled: false });
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="false"');
    expect(out).toContain('Activate Retries');
    expect(out).toContain(
      'Retries are only for messages that fail because of Meta&#x27;s frequency capping (error 131049).',
    );
    expect(out).toContain('They run at exactly 24-hour intervals until the end date.');
    expect(out).toContain(
      'No extra cost: you are only charged for a message when it is delivered.',
    );
    expect(out).not.toContain('Set an end date');
  });

  it('on: asks for an end date, with an inline error from the step check', () => {
    const out = card({ enabled: true, endDate: null }, [
      { path: 'retries.endDate', code: 'retry_end_required' },
    ]);
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain('Set an end date');
    expect(out).toContain('data-picker="date"');
    expect(out).toContain('Set an end date for retries.');
  });
});

describe('step 4 and the launch dialog', () => {
  const rule = { ...defaultRule('Asia/Kolkata', NOW), weekdays: [1] };
  const step = (d: WizardDraft) =>
    html(
      <StepSend
        draft={d}
        draftId={uuid(100)}
        zone="Asia/Kolkata"
        canTest
        templates={{
          data: { data: templates() },
          isPending: false,
          isError: false,
          error: null,
          refetch: none,
        }}
        issues={[]}
        currency="USD"
        ensureSaved={async () => true}
        dispatch={none}
      />,
    );

  it('stacks the test, when to send and retries', () => {
    const out = step(draft());
    const test = out.indexOf('Send a test WhatsApp message');
    const when = out.indexOf('When to send');
    const retries = out.indexOf('Activate Retries');
    expect(test).toBeGreaterThan(-1);
    expect(when).toBeGreaterThan(test);
    expect(retries).toBeGreaterThan(when);
  });

  it('ends with the follow-ups card, after the retries', () => {
    const out = step(draft());
    expect(out.indexOf('Follow-ups')).toBeGreaterThan(out.indexOf('Activate Retries'));
    expect(out).toContain('Add a follow-up');
    expect(out).toContain('0 of 3 follow-ups');
  });

  it('shows the recurring panel only for the recurring mode', () => {
    expect(step(draft({ schedule: { mode: 'recurring', rule } }))).toContain(
      'data-testid="recurrence-banner"',
    );
    expect(step(draft())).not.toContain('recurrence-banner');
  });

  const dialog = (d: WizardDraft, error: string | null = null) =>
    html(
      <LaunchDialog
        open
        busy={false}
        error={error}
        draft={d}
        template={template()}
        credit={credit()}
        recipients={950}
        skipped={50}
        onConfirm={none}
        onClose={none}
      />,
    );

  it('summarises the campaign for each mode with Confirm and Cancel', () => {
    const now = dialog(draft({ name: 'October offer' }));
    expect(now).toContain('Send now?');
    expect(now).toContain('October offer');
    expect(now).toContain('order_update (en_US)');
    expect(now).toContain('950');
    expect(now).toContain('$95.00');
    expect(now).toContain('Sent right away, once.');
    expect(now).toContain('>Cancel<');
    expect(now).toContain('>Send now<');
    const sch = dialog(
      draft({
        schedule: {
          mode: 'scheduled',
          date: '2026-10-09',
          time: '10:30',
          timezone: 'Asia/Kolkata',
        },
      }),
    );
    expect(sch).toContain('Schedule this campaign?');
    expect(sch).toContain('Sent once on Oct 9, 2026 at 10:30 (Asia/Kolkata).');
    const rec = dialog(draft({ schedule: { mode: 'recurring', rule } }));
    expect(rec).toContain('Start this recurring campaign?');
    expect(rec).toContain('Repeats every week on Monday');
    expect(rec).toContain('Each run goes to the audience as it is at that time');
  });

  it('shows the retry rule and an error when the launch failed', () => {
    const out = dialog(
      draft({ retries: { enabled: true, endDate: '2026-10-20', timezone: null } }),
      'The campaign could not be started. Try again.',
    );
    expect(out).toContain('On, until Oct 20, 2026');
    expect(out).toContain('The campaign could not be started.');
    expect(dialog(draft())).toContain('>Off<');
  });
});
