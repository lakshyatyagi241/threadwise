import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  ALL_PERMISSIONS,
  audience,
  count,
  failed,
  html,
  pending,
  ready,
  sender,
  previousSends,
  sources,
  templates,
  template,
  uuid,
} from '../testing';
import { audienceTally, tallyIsEmpty } from '../lib/audience';
import {
  clearContacts,
  contactSelected,
  coversView,
  selectAllMatching,
  setContacts,
} from '../lib/contacts-selection';
import { pageCount, pageWindow } from '../lib/paging';
import { ContactsTable } from './contacts-table';
import { CountPanel } from './count-panel';
import { CsvUpload } from './csv-upload';
import { StepAudience } from './step-audience';
import { StepTemplate } from './step-template';
import { TemplatePicker } from './template-picker';
import { SourcePicker } from './source-picker';
import { Stepper } from './stepper';
import { WizardFooter } from './wizard-footer';
import { SaveIndicator } from './save-indicator';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/campaigns/wizard',
  useSearchParams: () => new URLSearchParams(),
}));

const none = () => undefined;
const tplQuery = ready({ data: templates() });

describe('stepper', () => {
  it('marks the current step and compacts to "Step 2 of 4 - Audience" on a phone', () => {
    const out = html(<Stepper current={2} reached={3} onGo={none} />);
    expect(out).toContain('Step 2 of 4 - Audience');
    expect(out).toMatch(
      /role="progressbar"[^>]*aria-valuenow="2"|aria-valuenow="2"[^>]*role="progressbar"/,
    );
    expect(out.match(/aria-current="step"/g)).toHaveLength(1);
    for (const label of ['Name and template', 'Audience', 'Check and variables', 'Test and send']) {
      expect(out).toContain(label);
    }
  });

  it('a step not reached yet cannot be opened; reached ones can', () => {
    const out = html(<Stepper current={1} reached={2} onGo={none} />);
    const buttons = out.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    expect(buttons.filter((b) => / disabled=""/.test(b))).toHaveLength(2);
  });

  it('gives each step its own icon, and a check once the step is done', () => {
    const out = html(<Stepper current={3} reached={4} onGo={none} />);
    const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(4);
    // Every step button carries one icon; the two steps before the current one show the check (the same path), the others differ.
    const paths = buttons.map((b) => /<svg[\s\S]*?<\/svg>/.exec(b)?.[0] ?? '');
    expect(paths.every((p) => p !== '')).toBe(true);
    const check = 'M3 8l3 3 7-7';
    expect(paths.filter((p) => p.includes(check))).toHaveLength(2);
    expect(new Set(paths.slice(2)).size).toBe(2);
    // The compact phone line has the current step's icon too.
    expect(out.slice(0, out.indexOf('<ol'))).toContain('<svg');
  });

  it('is right-to-left safe in Arabic', () => {
    const out = html(<Stepper current={3} reached={3} onGo={none} />, { locale: 'ar' });
    expect(out).toContain('الخطوة 3 من 4');
    expect(out).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});

describe('footer and save indicator', () => {
  const footer = (over: Partial<Parameters<typeof WizardFooter>[0]> = {}) =>
    html(
      <WizardFooter
        step={1}
        launch="now"
        busy={false}
        blocked={[]}
        canLaunch
        onBack={none}
        onNext={none}
        {...over}
      />,
    );

  it('Back is off on the first step; Next reads Next', () => {
    const out = footer();
    expect(out).toContain('Next');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Back/);
  });

  it('the last step names the launch by the schedule mode', () => {
    expect(footer({ step: 4, launch: 'now' })).toContain('Send now');
    expect(footer({ step: 4, launch: 'schedule' })).toContain('>Schedule<');
    expect(footer({ step: 4, launch: 'recurring' })).toContain('Start recurring');
  });

  it('says why Next is blocked, and keeps the button reachable', () => {
    const out = footer({ blocked: ['Enter a name for the campaign.', 'Choose a template.'] });
    expect(out).toContain('Enter a name for the campaign.');
    expect(out).toContain('(+1 more)');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-describedby="wizard-blocked"');
  });

  it('warns when the person cannot launch', () => {
    expect(footer({ step: 4, canLaunch: false })).toContain(
      'do not have permission to start campaigns',
    );
  });

  it('shows saving, saved and failed states', () => {
    const state = (status: Parameters<typeof SaveIndicator>[0]['status']) =>
      html(<SaveIndicator status={status} onRetry={none} />);
    expect(state('saved')).toContain('Draft saved');
    expect(state('saving')).toContain('Saving...');
    expect(state('pending')).toContain('Saving...');
    const bad = state('error');
    expect(bad).toContain('Could not save');
    expect(bad).toContain('Retry');
    expect(state('conflict')).toContain('Could not save');
    expect(state('idle')).not.toContain('Draft saved');
  });
});

describe('step 1: name and template', () => {
  const step = (over: Partial<Parameters<typeof StepTemplate>[0]> = {}, perms?: string[]) =>
    html(
      <StepTemplate
        name=""
        templateId={null}
        senderKey={null}
        senders={[sender()]}
        templates={tplQuery}
        issues={[]}
        onName={none}
        onTemplate={none}
        onSender={none}
        {...over}
      />,
      { perms },
    );

  it('has a required Send from number next to the name, and says so when none is connected', () => {
    const one = step({ senderKey: sender().key });
    expect(one).toContain('Send from');
    expect(one).toContain('Acme Support (+919000000001) - Meta');
    expect(step({ senders: [] })).toContain('No WhatsApp number is connected');
    expect(
      step({ issues: [{ path: 'senderKey', code: 'sender_required' }], senders: [sender()] }),
    ).toContain('Pick the WhatsApp number to send from.');
  });

  it('tells each reason an empty list is empty, with the action that fixes it', () => {
    const empty = (hidden: Parameters<typeof StepTemplate>[0]['hidden']) =>
      step({ senders: [], hidden });
    const none = empty([]);
    expect(none).toContain('data-cause="none"');
    expect(none).toContain('Connect a WhatsApp Business number');
    expect(none).toContain('href="/channels/whatsapp"');
    const off = empty([{ engine: 'baileys', reason: 'unofficial_disabled', count: 1 }]);
    expect(off).toContain('data-cause="personal_off"');
    expect(off).toContain('Personal numbers are turned off for this workspace');
    expect(off).toContain('A platform administrator can turn it on');
    const pending = empty([{ engine: 'waba', reason: 'pending', count: 1 }]);
    expect(pending).toContain('1 number is still connecting');
    expect(pending).toContain('href="/channels/whatsapp"');
    expect(empty([{ engine: 'waba', reason: 'error', count: 2 }])).toContain(
      'The connection of 2 numbers failed',
    );
    expect(empty([{ engine: 'twilio', reason: 'not_connected', count: 1 }])).toContain(
      '1 number is disconnected',
    );
    // Never the bare old message, and the select is not offered with nothing in it.
    for (const out of [none, off, pending]) {
      expect(out).not.toContain('Connect one first');
      expect(out).not.toContain('<select id="wizard-sender"');
    }
  });

  it('shows a skeleton while the numbers load, not an empty dropdown', () => {
    const out = step({ senders: undefined });
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-label="Loading your numbers…"');
    expect(out).not.toContain('<select id="wizard-sender"');
    expect(out).not.toContain('data-cause');
  });

  it('lists the approved templates as radio cards with language, category and sender', () => {
    const out = step();
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/type="radio"/g)).toHaveLength(3);
    for (const name of ['order_update', 'summer_sale', 'otp_code']) expect(out).toContain(name);
    expect(out).toContain('en_US');
    expect(out).toContain('Utility');
    expect(out).toContain('Marketing');
    expect(out).toContain('Sent from +91 98000 00001');
    expect(out).toContain('Showing 3 of 3 templates');
  });

  it('has a search box and language and category filters built from the data', () => {
    const out = step();
    expect(out).toContain('aria-label="Search templates"');
    expect(out).toContain('aria-label="Filter by language"');
    expect(out).toContain('<option value="hi">hi</option>');
    expect(out).toContain('<option value="authentication">Authentication</option>');
  });

  it('the name is required, limited to 191 characters and labelled', () => {
    const out = step();
    expect(out).toContain('for="wizard-name"');
    expect(out).toContain('maxLength="191"');
    expect(step({ name: 'October offer' })).toContain('value="October offer"');
  });

  it('shows inline validation after a try', () => {
    const out = step({
      issues: [
        { path: 'name', code: 'name_required' },
        { path: 'templateId', code: 'template_required' },
      ],
    });
    expect(out).toContain('Enter a name for the campaign.');
    expect(out).toContain('Choose a template.');
    expect(out).toContain('aria-invalid="true"');
  });

  it('previews the selected template in the WhatsApp bubble, placeholders highlighted', () => {
    const out = step({ templateId: uuid(1) });
    expect(out).toContain('data-testid="phone-preview"');
    expect(out).toContain('{{1}}');
    expect(out).toContain('bg-success/15');
    expect(out).toContain('Reply STOP to opt out');
    expect(out).toContain('Track order');
    expect(out).toMatch(/checked=""/);
    expect(out).toContain('2 variables are filled in the next steps.');
  });

  it('asks for a choice while nothing is selected', () => {
    expect(step()).toContain('Choose a template to see how the message looks.');
  });

  it('shows a loading state, an error with retry, and an empty state that links to the new-template form', () => {
    expect(step({ templates: pending })).toContain('Loading templates');
    const bad = step({ templates: failed(new ApiError(500, 'INTERNAL', 'x', 'req-9')) });
    expect(bad).toContain('Something went wrong on our side');
    expect(bad).not.toContain('req-9');
    expect(bad).toContain('Try again');
    const empty = step({ templates: ready({ data: [] }) }, [
      ...ALL_PERMISSIONS,
      'tpl.templates.create',
    ]);
    expect(empty).toContain('No approved templates yet');
    expect(empty).toContain('href="/templates/new"');
  });

  it('opens the new-template form on the chosen number, and offers no link to a person who may not create templates', () => {
    const n = sender();
    const tied = step(
      { templates: ready({ data: [] }), senderKey: `waba:${uuid(77)}`, senders: [n] },
      [...ALL_PERMISSIONS, 'tpl.templates.create'],
    );
    expect(tied).toContain(`href="/templates/new?connection=${uuid(77)}"`);
    const noRight = step({ templates: ready({ data: [] }) });
    expect(noRight).toContain('No approved templates yet');
    expect(noRight).not.toContain('/templates/new');
  });
});

describe('template picker filters', () => {
  const picker = (initialFilters: Parameters<typeof TemplatePicker>[0]['initialFilters']) =>
    html(
      <TemplatePicker
        templates={tplQuery}
        selectedId={null}
        onSelect={none}
        initialFilters={initialFilters}
      />,
    );

  it('narrows by text, language and category', () => {
    const byText = picker({ q: 'summer', language: '', category: '' });
    expect(byText).toContain('summer_sale');
    expect(byText).not.toContain('order_update');
    expect(byText).toContain('Showing 1 of 3 templates');
    expect(picker({ q: '', language: 'hi', category: '' })).not.toContain('otp_code');
    expect(picker({ q: '', language: '', category: 'authentication' })).not.toContain(
      'summer_sale',
    );
  });

  it('says nothing matches and offers to clear the filters', () => {
    const out = picker({ q: 'zzz', language: '', category: '' });
    expect(out).toContain('No template matches');
    expect(out).toContain('Clear filters');
    expect(out).not.toContain('type="radio"');
  });

  it('works for a template with no sender', () => {
    const out = html(
      <TemplatePicker
        templates={ready({ data: [template({ senderLabel: null })] })}
        selectedId={null}
        onSelect={none}
      />,
    );
    expect(out).not.toContain('Sent from');
  });
});

describe('step 2: audience', () => {
  const picker = (
    kind: 'groups' | 'segments',
    over: Partial<Parameters<typeof SourcePicker>[0]> = {},
  ) =>
    html(
      <SourcePicker kind={kind} sources={ready(sources())} chosen={[]} onChange={none} {...over} />,
    );

  it('lists groups with member counts and the chosen count', () => {
    const out = picker('groups', { chosen: [uuid(11)] });
    expect(out).toContain('VIP customers');
    expect(out).toContain('120 contacts');
    expect(out).toContain('4,300 contacts');
    expect(out).toContain('1 chosen');
    expect(out.match(/type="checkbox"/g)).toHaveLength(2);
    expect(out).toContain('<legend');
    expect(out).toContain('Select all');
    expect(out).not.toContain('Search groups'); // short lists need no search
    expect(out).not.toContain('Active last 30 days'); // one list per mode
  });

  it('lists segments, with "count not ready" while a segment has no count yet', () => {
    const out = picker('segments');
    expect(out).toContain('Active last 30 days');
    expect(out).toContain('Count not ready');
    expect(out.match(/type="checkbox"/g)).toHaveLength(1);
  });

  it('adds a search box for long lists, and says when there are none', () => {
    const many = {
      groups: Array.from({ length: 8 }, (_, i) => ({
        id: uuid(200 + i),
        name: `G${i}`,
        color: null,
        memberCount: i,
      })),
      segments: [],
      previousSends: [],
    };
    expect(picker('groups', { sources: ready(many) })).toContain('aria-label="Search groups"');
    expect(picker('segments', { sources: ready(many) })).toContain('No segments yet.');
  });

  it('has loading and error states', () => {
    expect(picker('groups', { sources: pending })).toContain('Loading groups and segments');
    expect(picker('groups', { sources: failed() })).toContain('Could not reach the server');
  });

  const step = (over: Partial<Parameters<typeof StepAudience>[0]> = {}) =>
    html(
      <StepAudience
        audience={audience()}
        sources={ready(sources())}
        count={ready(count())}
        countUpdating={false}
        hasSource
        issues={[]}
        template={null}
        onAudience={none}
        {...over}
      />,
    );

  it('shows the five campaign actions as pills, one active, and the rule that joins them', () => {
    const out = step();
    expect(out).toContain('Send to');
    for (const label of [
      'Send to contacts',
      'Send to groups',
      'Send to segments',
      'Send via CSV',
      'Send to previous sends',
    ]) {
      expect(out).toContain(label);
    }
    expect(out.match(/role="tab"/g)).toHaveLength(5);
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(out).toContain('role="tabpanel"');
    expect(out).toContain('Nothing selected yet.');
    expect(out).toContain('messaged once');
  });

  it('has a Previous sends mode that opens on a draft holding one, with the picker and a chip', () => {
    const previous = {
      sends: [{ kind: 'campaign' as const, id: previousSends()[1]!.id }],
      outcome: 'not_read' as const,
    };
    const out = step({
      audience: audience({ previous }),
      sources: ready({ ...sources(), previousSends: previousSends() }),
    });
    expect(out.match(/role="tab"/g)).toHaveLength(5);
    expect(out).toContain('Send to previous sends');
    expect(out).toMatch(
      /aria-selected="true"[^>]*>Send to previous sends|Send to previous sends[\s\S]{0,20}aria-selected/,
    );
    expect(out).toContain('Re-target the people earlier broadcasts and campaigns went to');
    expect(out).toContain('Spring win-back');
    expect(out).toContain('1 earlier send (Did not read)');
    expect(out).toContain('70 people did not read it');
    expect(out).not.toContain('Nothing selected yet.');
  });

  it('keeps the count panel and the template preview on the right', () => {
    const out = step({ template: templates()[0]!, senderName: 'Acme Support' });
    expect(out).toContain('Matching contacts');
    expect(out).toContain('Will be messaged');
    expect(out).toContain('data-testid="phone-preview"');
    expect(out).toContain('Acme Support');
    expect(out).toContain('{{1}}');
    expect(step()).toContain('data-testid="phone-preview-empty"');
  });

  it('opens on the mode that already holds a selection and shows what each mode holds', () => {
    const out = step({
      audience: audience({
        groupIds: [uuid(11), uuid(12)],
        segmentIds: [uuid(21)],
        contactIds: [uuid(301), uuid(302), uuid(303)],
        csv: {
          id: uuid(401),
          fileName: 'a.csv',
          valid: 340,
          duplicate: 1,
          invalid: 2,
          optedOut: 0,
        },
      }),
    });
    expect(out).toContain('3 contacts');
    expect(out).toContain('2 groups');
    expect(out).toContain('1 segment');
    expect(out).toContain('340 from CSV');
    const groupsOnly = step({ audience: audience({ groupIds: [uuid(11)] }) });
    expect(groupsOnly).toContain('Groups are your marketing lists.');
    expect(groupsOnly).toContain('VIP customers');
  });

  it('shows what the Contact Hub sent, ticked rows or the whole view, with a way to remove it', () => {
    const ticked = step({
      audience: audience({ selection: { ids: [uuid(1), uuid(2)] } }),
    });
    expect(ticked).toContain('Chosen in the Contact Hub');
    expect(ticked).toContain('2 contacts ticked');
    expect(ticked).toContain('Remove');
    const view = step({
      audience: audience({
        selection: {
          filter: { q: 'a', includeArchived: false, tagMode: 'any' },
          excludeIds: [uuid(3)],
        },
      }),
    });
    expect(view).toContain('Everything the Contact Hub view matched (1 left out)');
    expect(tallyIsEmpty(audienceTally(audience({ selection: { ids: [uuid(1)] } })))).toBe(false);
    expect(step()).not.toContain('Chosen in the Contact Hub');
  });

  it('shows the problem after a try', () => {
    const out = step({
      issues: [{ path: 'audience', code: 'audience_required' }],
      hasSource: false,
    });
    expect(out).toContain('Choose who receives it: contacts, groups, segments or a CSV file.');
  });
});

describe('contacts table', () => {
  const rows = [
    {
      id: uuid(301),
      name: 'Asha Rao',
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.com',
      phone: '+919800000001',
      sendable: true,
      optedOut: false,
    },
    {
      id: uuid(302),
      name: 'Bela Shah',
      firstName: 'Bela',
      lastName: 'Shah',
      email: null,
      phone: '+919800000002',
      sendable: false,
      optedOut: true,
    },
  ];
  const table = (a = audience(), total = 87) => {
    const qc = new QueryClient();
    qc.setQueryData(
      ['camp', 'wizard', 'contacts', { search: '', rules: null, page: 1, perPage: 25 }],
      {
        data: rows,
        total,
        approximate: false,
        page: 1,
        perPage: 25,
      },
    );
    return html(<ContactsTable audience={a} onAudience={none} />, { qc });
  };

  it('has the columns, a checkbox per row, select-all for the page, the total, pages and the page size', () => {
    const out = table();
    for (const c of ['First name', 'Last name', 'Primary email', 'Mobile'])
      expect(out).toContain(c);
    expect(out).toContain('aria-label="Select all contacts on this page"');
    expect(out).toContain('aria-label="Select Asha Rao"');
    expect(out).toContain('asha@example.com');
    expect(out).toContain('Total 87 contacts');
    expect(out).toContain('aria-label="Go to page 4"'); // 87 contacts at 25 a page
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('<option value="50">50</option>');
    expect(out).toContain('<option value="100">100</option>');
    expect(out).toContain('aria-label="Search contacts"');
  });

  it('shows an opted-out contact but cannot select it', () => {
    const out = table();
    expect(out).toContain('Opted out');
    expect(out).toMatch(
      /aria-label="Select Bela Shah"[^>]*disabled=""|disabled=""[^>]*aria-label="Select Bela Shah"/,
    );
  });

  it('the filter button has a badge with the number of active conditions', () => {
    expect(table()).not.toContain('data-testid="filter-badge"');
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
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'wizard', 'contacts', { search: '', rules, page: 1, perPage: 25 }], {
      data: rows,
      total: 2,
      approximate: false,
      page: 1,
      perPage: 25,
    });
    const out = html(<ContactsTable audience={audience({ rules })} onAudience={none} />, { qc });
    expect(out).toMatch(/data-testid="filter-badge"[^>]*>1</);
    expect(out).toContain('Total 2 contacts');
  });

  it('offers "select all N matching" once the whole page is ticked, and says so when it is chosen', () => {
    const ticked = table(audience({ contactIds: [uuid(301)] }));
    expect(ticked).toContain('Select all 87 matching contacts');
    const all = table(audience({ allMatching: { search: null, rules: null } }));
    expect(all).toContain('All 87 matching contacts are selected.');
    expect(all).not.toContain('Select all 87 matching contacts');
  });

  it('has a loading state, and an empty state that links to the contacts', () => {
    expect(html(<ContactsTable audience={audience()} onAudience={none} />)).toContain(
      'Loading contacts',
    );
    const qc = new QueryClient();
    qc.setQueryData(
      ['camp', 'wizard', 'contacts', { search: '', rules: null, page: 1, perPage: 25 }],
      {
        data: [],
        total: 0,
        approximate: false,
        page: 1,
        perPage: 25,
      },
    );
    const out = html(<ContactsTable audience={audience()} onAudience={none} />, { qc });
    expect(out).toContain('There are no contacts yet.');
    expect(out).toContain('href="/contacts"');
  });
});

describe('contacts selection', () => {
  const view = { search: '', rules: null };
  it('ticks and un-ticks rows; all-matching covers the rows it was chosen for and keeps the ones un-ticked out', () => {
    let a = audience();
    a = { ...a, ...setContacts(a, [uuid(1), uuid(2)], true, view).patch };
    expect(a.contactIds).toEqual([uuid(1), uuid(2)]);
    expect(contactSelected(a, uuid(1), view)).toBe(true);
    a = { ...a, ...selectAllMatching(view) };
    expect(a.contactIds).toEqual([]);
    expect(contactSelected(a, uuid(9), view)).toBe(true);
    a = { ...a, ...setContacts(a, [uuid(9)], false, view).patch };
    expect(a.excludedContactIds).toEqual([uuid(9)]);
    expect(contactSelected(a, uuid(9), view)).toBe(false);
    a = { ...a, ...setContacts(a, [uuid(9)], true, view).patch };
    expect(a.excludedContactIds).toEqual([]);
    expect(a.contactIds).toEqual([]);
  });

  it('under a different search or filter only the ticked rows count as selected', () => {
    const a = audience({ ...selectAllMatching(view), contactIds: [uuid(5)] });
    const other = { search: 'asha', rules: null };
    expect(coversView(a, view)).toBe(true);
    expect(coversView(a, other)).toBe(false);
    expect(contactSelected(a, uuid(9), other)).toBe(false);
    expect(contactSelected(a, uuid(5), other)).toBe(true);
  });

  it('stops at the limit and says so', () => {
    const full = audience({ contactIds: Array.from({ length: 5000 }, (_, i) => uuid(i + 1)) });
    const out = setContacts(full, [uuid(9001)], true, view);
    expect(out.limited).toBe(true);
    expect(out.patch.contactIds).toHaveLength(5000);
  });

  it('clears everything, and tallies what each mode holds', () => {
    expect(clearContacts()).toEqual({ allMatching: null, contactIds: [], excludedContactIds: [] });
    expect(tallyIsEmpty(audienceTally(audience()))).toBe(true);
    expect(audienceTally(audience({ groupIds: [uuid(1)], contactIds: [uuid(2)] }))).toMatchObject({
      contacts: 1,
      groups: 1,
    });
  });

  it('tallies the previous sends, and counts them as a selection', () => {
    const previous = {
      sends: [{ kind: 'campaign' as const, id: uuid(32) }],
      outcome: 'read' as const,
    };
    expect(audienceTally(audience({ previous }))).toMatchObject({
      previous: 1,
      previousOutcome: 'read',
    });
    expect(tallyIsEmpty(audienceTally(audience({ previous })))).toBe(false);
    expect(tallyIsEmpty(audienceTally(audience({ previous: { sends: [], outcome: 'all' } })))).toBe(
      true,
    );
  });

  it('pages numbers with gaps', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 20)).toEqual([1, 2, null, 4, 5, 6, null, 19, 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 19, 20]);
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(87, 25)).toBe(4);
  });
});

describe('CSV mode', () => {
  const report = {
    id: uuid(401),
    fileName: 'numbers.csv',
    totalRows: 8,
    valid: 5,
    duplicate: 1,
    invalid: 2,
    optedOut: 1,
    existing: 2,
    newContacts: 3,
    preview: [
      { line: 2, phone: '+919876520001', name: 'Eva', status: 'existing' as const },
      { line: 4, phone: '+919876520003', name: null, status: 'new' as const },
      { line: 3, phone: '+919876520002', name: 'Olga', status: 'optedOut' as const },
    ],
    issues: [
      { line: 5, value: '+91 98765 20003', reason: 'duplicate' as const },
      { line: 6, value: '12345', reason: 'invalid_phone' as const },
    ],
    issuesTotal: 3,
    expiresAt: null,
  };
  const csvRef = {
    id: uuid(401),
    fileName: 'numbers.csv',
    valid: 5,
    duplicate: 1,
    invalid: 2,
    optedOut: 1,
  };

  it('asks for a file: drop zone, limits, and the template', () => {
    const out = html(<CsvUpload csv={null} onCsv={none} />);
    expect(out).toContain('Drag a CSV file here');
    expect(out).toContain('type="file"');
    expect(out).toContain('Up to 2 MB and 10,000 rows');
    expect(out).toContain('Download the template');
    expect(out).toContain('phone, first_name, last_name');
  });

  it('shows the parsed report: counts, preview with line numbers, the problems and the error download', () => {
    const qc = new QueryClient();
    qc.setQueryData(['camp', 'wizard', 'csv', uuid(401)], report);
    const out = html(<CsvUpload csv={csvRef} onCsv={none} />, { qc });
    expect(out).toContain('numbers.csv');
    for (const label of ['Valid numbers', 'Duplicates', 'Invalid', 'Opted out', 'New contacts']) {
      expect(out).toContain(label);
    }
    expect(out).toContain('+919876520001');
    expect(out).toContain('Existing contact');
    expect(out).toContain('3 rows cannot be used');
    expect(out).toContain('Line 5');
    expect(out).toContain('12345');
    expect(out).toContain('Not a valid number');
    expect(out).toContain('Download error list');
    expect(out).toContain('Replace file');
    expect(out).toContain('2 of the valid numbers are contacts already');
  });
});

describe('matching contacts panel', () => {
  const panel = (props: Partial<Parameters<typeof CountPanel>[0]> = {}) =>
    html(<CountPanel count={ready(count())} hasSource updating={false} {...props} />);

  it('shows matching, excluded and who will be messaged', () => {
    const out = panel();
    expect(out).toContain('Matching contacts');
    expect(out).toContain('1,000');
    expect(out).toContain('Opted out');
    expect(out).toContain('Invalid numbers');
    expect(out).toContain('always skipped');
    expect(out).toContain('Will be messaged');
    expect(out).toMatch(/data-testid="recipients">950</);
  });

  it('says "about N" for an estimate', () => {
    const out = panel({ count: ready(count({ approximate: true })) });
    expect(out).toContain('about 950');
    expect(out).toContain('This is an estimate');
  });

  it('warns about an empty audience and about conditions that point at deleted things', () => {
    const out = panel({
      count: ready(
        count({
          recipients: 0,
          invalidConditions: [
            { path: 'children.0', field: 'tags', reason: 'tag_deleted', message: 'x' },
          ],
        }),
      ),
    });
    expect(out).toContain('No contact would be messaged.');
    expect(out).toContain('1 condition points at something that was deleted');
  });

  it('has idle, loading, updating and error states', () => {
    expect(panel({ hasSource: false })).toContain('Select contacts, groups or segments');
    expect(panel({ count: pending })).toContain('Counting contacts');
    expect(panel({ updating: true })).toContain('Updating...');
    expect(panel({ updating: true })).toContain('aria-busy="true"');
    const bad = panel({ count: failed() });
    expect(bad).toContain('Could not reach the server');
    expect(bad).toContain('Try again');
  });

  it('keeps the last numbers on screen when a refresh fails', () => {
    const stale = { ...ready(count()), isError: true, error: new Error('x') };
    const out = panel({ count: stale });
    expect(out).toContain('Will be messaged');
    expect(out).toContain('Could not reach the server');
  });
});

describe('query client usage', () => {
  it('renders without seeded data', () => {
    expect(
      html(<Stepper current={1} reached={1} onGo={none} />, { qc: new QueryClient() }),
    ).toContain('Step 1 of 4');
  });
});
