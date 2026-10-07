import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { count, failed, html, pending, ready, sources, templates, uuid } from '../testing';
import { CountPanel } from './count-panel';
import { StepAudience } from './step-audience';
import { StepTemplate } from './step-template';
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
    expect(footer({ step: 4, launch: 'now' })).toContain('Broadcast now');
    expect(footer({ step: 4, launch: 'schedule' })).toContain('>Schedule<');
    expect(footer({ step: 4, launch: 'recurring' })).toContain('Start recurring');
  });

  it('says why Next is blocked, and keeps the button reachable', () => {
    const out = footer({ blocked: ['Enter a name for the broadcast.', 'Choose a template.'] });
    expect(out).toContain('Enter a name for the broadcast.');
    expect(out).toContain('(+1 more)');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-describedby="wizard-blocked"');
  });

  it('warns when the person cannot launch', () => {
    expect(footer({ step: 4, canLaunch: false })).toContain(
      'do not have permission to start broadcasts',
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
  const step = (over: Partial<Parameters<typeof StepTemplate>[0]> = {}) =>
    html(
      <StepTemplate
        name=""
        templateId={null}
        noSender={false}
        templates={tplQuery}
        issues={[]}
        onName={none}
        onTemplate={none}
        {...over}
      />,
    );

  it('shows no Send from field: the default number is used, and a notice when there is none', () => {
    const out = step();
    expect(out).not.toContain('Send from');
    expect(out).not.toContain('wizard-sender');
    expect(step({ noSender: true })).toContain('No WhatsApp number is connected');
    expect(step({ issues: [{ path: 'senderKey', code: 'sender_required' }] })).toContain(
      'Pick the WhatsApp number to send from.',
    );
  });

  it('offers the approved templates in one dropdown below the name', () => {
    const out = step();
    expect(out).toContain('for="wizard-template"');
    expect(out).not.toContain('role="radiogroup"');
    expect(out.indexOf('wizard-name')).toBeLessThan(out.indexOf('wizard-template'));
    for (const name of ['order_update', 'summer_sale', 'otp_code']) expect(out).toContain(name);
    expect(out).toContain('order_update (en_US)');
    expect(out).toContain('Choose an approved template');
  });

  it('keeps the preview on the right half of the page', () => {
    expect(step()).toContain('lg:grid-cols-2');
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
    expect(out).toContain('Enter a name for the broadcast.');
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
    expect(out).toContain('selected=""');
    expect(out).toContain('2 variables are filled in the next steps.');
  });

  it('asks for a choice while nothing is selected', () => {
    const out = step();
    expect(out).toContain('Choose a template to see how the message looks.');
    expect(out).toContain('data-testid="phone-preview-empty"');
  });

  it('shows a loading state, an error with retry, and an empty state that links to /templates', () => {
    expect(step({ templates: pending })).toContain('Loading templates');
    const bad = step({ templates: failed(new ApiError(500, 'INTERNAL', 'x', 'req-9')) });
    expect(bad).toContain('Something went wrong on our side');
    expect(bad).toContain('req-9');
    expect(bad).toContain('Try again');
    const empty = step({ templates: ready({ data: [] }) });
    expect(empty).toContain('No approved templates yet');
    expect(empty).toContain('href="/templates"');
  });
});

describe('step 2: audience', () => {
  it('lists groups and segments with member counts and the chosen count', () => {
    const out = html(
      <SourcePicker
        sources={ready(sources())}
        groupIds={[uuid(11)]}
        segmentIds={[]}
        onGroups={none}
        onSegments={none}
      />,
    );
    expect(out).toContain('VIP customers');
    expect(out).toContain('120 contacts');
    expect(out).toContain('4,300 contacts');
    expect(out).toContain('Count not ready');
    expect(out).toContain('1 chosen');
    expect(out.match(/type="checkbox"/g)).toHaveLength(3);
    expect(out).toContain('<legend');
    expect(out).not.toContain('Search groups'); // short lists need no search
  });

  it('adds a search box for long lists', () => {
    const many = {
      groups: Array.from({ length: 8 }, (_, i) => ({
        id: uuid(200 + i),
        name: `G${i}`,
        color: null,
        memberCount: i,
      })),
      segments: [],
    };
    const out = html(
      <SourcePicker
        sources={ready(many)}
        groupIds={[]}
        segmentIds={[]}
        onGroups={none}
        onSegments={none}
      />,
    );
    expect(out).toContain('aria-label="Search groups"');
    expect(out).toContain('No segments yet.');
  });

  it('has loading and error states', () => {
    const base = { groupIds: [], segmentIds: [], onGroups: none, onSegments: none };
    expect(html(<SourcePicker sources={pending} {...base} />)).toContain(
      'Loading groups and segments',
    );
    expect(html(<SourcePicker sources={failed()} {...base} />)).toContain(
      'Could not reach the server',
    );
  });

  const step = (over: Partial<Parameters<typeof StepAudience>[0]> = {}) =>
    html(
      <StepAudience
        audience={{ groupIds: [], segmentIds: [], rules: null }}
        sources={ready(sources())}
        count={ready(count())}
        countUpdating={false}
        hasSource
        issues={[]}
        onAudience={none}
        {...over}
      />,
    );

  it('explains how groups, segments and conditions combine, and shows the builder area', () => {
    const out = step();
    expect(out).toContain(
      'Contacts in the selected groups or segments that also match the conditions. With no group or segment, the conditions select from all contacts.',
    );
    expect(out).toContain('Filter conditions');
    expect(out).toContain('Groups and segments');
    expect(out).toContain('Loading the fields'); // the field catalog loads from the contacts module
  });

  it('shows the rule problem after a try', () => {
    const out = step({
      issues: [{ path: 'audience', code: 'audience_required' }],
      hasSource: false,
    });
    expect(out).toContain('Choose at least one group or segment, or add a condition.');
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
    expect(panel({ hasSource: false })).toContain(
      'Choose a group or a segment, or add a condition',
    );
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
