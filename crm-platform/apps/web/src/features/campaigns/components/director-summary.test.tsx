import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionResponse, SummaryFormRef, SummaryPerson } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { summaryFixture } from '../lib/summary-fixtures';
import {
  DirectorSummary,
  PRINT_CSS,
  PeopleTable,
  SummaryView,
  type SummaryViewProps,
} from './director-summary';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => '/campaigns/abc',
  useSearchParams: () => new URLSearchParams('window=14'),
}));

const ID = '00000000-0000-4000-8000-000000000001';
const FORM: SummaryFormRef = {
  id: '00000000-0000-4000-8000-0000000000f1',
  kind: 'web',
  name: 'Apply 2026',
};

function render(
  el: ReactElement,
  locale = 'en',
  perms: string[] = ['camp.campaigns.read', 'camp.campaigns.export'],
) {
  const session = {
    user: { id: '00000000-0000-4000-8000-0000000000aa' },
    permissions: Object.fromEntries(perms.map((p) => [p, true])),
    effectiveTimezone: 'UTC',
  } as unknown as SessionResponse;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider session={session}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const props = (over: Partial<SummaryViewProps> = {}): SummaryViewProps => ({
  kind: 'campaign',
  id: ID,
  state: { isPending: false, isError: false, data: summaryFixture() },
  onRetry: () => undefined,
  days: 7,
  onDays: () => undefined,
  forms: [FORM],
  formsLoaded: true,
  formsFailed: false,
  formIds: [],
  onFormIds: () => undefined,
  canSeeNames: true,
  canDownload: true,
  onPrint: () => undefined,
  onDownload: () => undefined,
  downloading: false,
  printedAt: null,
  ...over,
});

const view = (over: Partial<SummaryViewProps> = {}, locale = 'en') =>
  render(<SummaryView {...props(over)} />, locale);

describe('the summary in English', () => {
  it('opens with the one-sentence headline in plain words', () => {
    const out = view();
    expect(out).toContain(
      'You messaged 1,240 people. 1,150 received it, 810 opened it, 164 wrote back within 7 days, and 31 filled in an application form.',
    );
  });

  it('shows five tiles as a list, each with the count, a percentage in words and an explanation', () => {
    const out = view();
    expect(out).toContain('aria-label="The numbers"');
    expect((out.match(/<li class="dsum-tile/g) ?? []).length).toBe(5);
    for (const label of ['Messaged', 'Received', 'Opened', 'Wrote back', 'Filled a form']) {
      expect(out).toContain(`>${label}</p>`);
    }
    expect(out).toContain('13% of the people you messaged');
    expect(out).toContain('People who sent you a message within 7 days of the send.');
    expect(out).toContain('People who filled in any of your application forms.');
    // The number has a spoken unit, so a screen reader hears "164 people".
    expect(out).toContain('<span class="sr-only"> people</span>');
  });

  it('draws one funnel with a text alternative and one quiet daily chart', () => {
    const out = view();
    expect(out).toContain('From message to application form');
    expect(out).toContain(
      'aria-label="Number of people at each step, from messaged to filled a form"',
    );
    expect(out).toContain('People writing back each day');
    expect(out).toContain(
      'aria-label="164 people wrote back. The busiest day was Oct 2, with 90 people."',
    );
  });

  it('offers the window, the forms and the print and download buttons', () => {
    const out = view();
    expect(out).toContain('Within 3 days');
    expect(out).toContain('Within 7 days');
    expect(out).toContain('Within 14 days');
    expect(out).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="7"/);
    expect(out).toContain('Which forms count as an application?');
    expect(out).toContain('Print summary');
    expect(out).toContain('Download names');
  });

  it('hides the names and the download from people who may not have them', () => {
    const none = view({ canSeeNames: false, canDownload: false });
    expect(none).not.toContain('See who');
    expect(none).not.toContain('Download names');
    const noExport = view({ canDownload: false });
    expect(noExport).toContain('See who');
    expect(noExport).not.toContain('Download names');
  });

  it('lists the three names lists, closed until opened', () => {
    const out = view();
    expect(out).toContain('See who');
    expect(out).toContain('Wrote back (164)');
    expect(out).toContain('Filled a form (31)');
    expect(out).toContain('>Not reached<');
    expect(out).toMatch(/aria-expanded="false"/);
  });

  it('shows no form tile, sentence part, picker or list when the viewer may not see forms', () => {
    const out = view({
      state: { isPending: false, isError: false, data: summaryFixture({ filledForm: null }) },
    });
    expect((out.match(/<li class="dsum-tile/g) ?? []).length).toBe(4);
    expect(out).not.toContain('Filled a form');
    expect(out).not.toContain('Which forms count');
    expect(out).not.toContain('and 31 filled');
    expect(out).not.toContain('>31<');
    expect(out).toContain('164 wrote back within 7 days.');
  });

  it('says plainly when nobody has written back', () => {
    const out = view({
      state: {
        isPending: false,
        isError: false,
        data: summaryFixture({
          cameBack: { count: 0, pctOfMessaged: 0, pctOfDelivered: 0, medianHoursToReply: null },
          cameBackByDay: [],
        }),
      },
    });
    expect(out).toContain('No one has written back yet.');
    expect(out).toContain('None of the people you messaged');
  });

  it('turns caveat codes into calm sentences', () => {
    const out = view({
      state: {
        isPending: false,
        isError: false,
        data: summaryFixture({
          people: { messaged: 1240, delivered: 1150, read: 810, failed: 90, notTrackable: 12 },
          caveats: [
            'recipients_without_contact',
            'contact_match_only',
            'opted_out_excluded',
            'counted_in_other_campaigns',
          ],
        }),
      },
    });
    expect(out).toContain('Good to know');
    expect(out).toContain(
      '12 people could not be matched to a contact, so we cannot tell whether they wrote back.',
    );
    expect(out).toContain('We match people to your contacts by phone number.');
    expect(out).toContain('People who asked not to be messaged are not counted.');
    expect(out).toContain('can be counted in each of them');
    // A caveat is information, not an alarm.
    expect(out).not.toMatch(/role="alert"/);
  });

  it('uses the form count in the explanation when some forms are picked', () => {
    const base = summaryFixture();
    const out = view({
      state: {
        isPending: false,
        isError: false,
        data: {
          ...base,
          filledForm: {
            ...base.filledForm!,
            allForms: false,
            formsCounted: [FORM, { ...FORM, id: 'x2' }],
          },
        },
      },
    });
    expect(out).toContain('People who filled in one of the 2 forms you chose.');
  });

  it('says a campaign that is still sending will keep growing', () => {
    const out = view({
      state: { isPending: false, isError: false, data: summaryFixture({ status: 'running' }) },
    });
    expect(out).toContain('Still sending, so these numbers will keep growing.');
  });

  it('says nothing has been sent yet, with no tiles', () => {
    const out = view({
      state: {
        isPending: false,
        isError: false,
        data: summaryFixture({
          sentAt: null,
          status: 'scheduled',
          people: { messaged: 0, delivered: 0, read: 0, failed: 0, notTrackable: 0 },
        }),
      },
    });
    expect(out).toContain('Nothing has been sent yet');
    expect(out).not.toContain('<li class="dsum-tile');
    expect(out).not.toContain('Print summary');
  });

  it('shows a skeleton while loading and an error with a retry', () => {
    const loading = view({ state: { isPending: true, isError: false, data: undefined } });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Loading your summary');
    const err = view({ state: { isPending: false, isError: true, data: undefined } });
    expect(err).toContain('We could not load this summary.');
    expect(err).toContain('Try again');
    expect(err).not.toContain('<li class="dsum-tile');
  });

  it('shows the loading skeleton from the connected screen before anything is read', () => {
    const out = render(<DirectorSummary kind="campaign" id={ID} />);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('Within 14 days');
  });
});

describe('the printed page', () => {
  it('is one A4 page that hides the screen around it', () => {
    expect(PRINT_CSS).toContain('@media print');
    expect(PRINT_CSS).toContain('size: A4');
    expect(PRINT_CSS).toContain('.no-print { display: none !important; }');
    expect(PRINT_CSS).toContain('body * { visibility: hidden !important; }');
  });

  it('carries the campaign, the date sent, the window and when it was printed', () => {
    const out = view({ printedAt: new Date('2026-10-14T08:00:00Z') });
    expect(out).toContain('dsum-print-only');
    expect(out).toContain('Open day 2026');
    expect(out).toContain('Sent October 1, 2026');
    expect(out).toContain('Counting replies and forms within 7 days of the send');
    expect(out).toContain('Printed October 14, 2026');
  });

  it('keeps the controls and the name lists off the paper', () => {
    const out = view();
    expect(out).toMatch(/no-print[^"]*"[^>]*>\s*<fieldset/);
    expect(out).toMatch(/<section class="[^"]*no-print[^"]*" aria-labelledby="dsum-people-title"/);
  });
});

describe('names in the lists', () => {
  const people: SummaryPerson[] = [
    {
      contactId: '00000000-0000-4000-8000-0000000000c1',
      name: '<img src=x onerror=alert(1)>',
      phone: '+919000000001',
      at: '2026-10-02T10:30:00.000Z',
      formName: '<script>alert(2)</script>',
    },
    { contactId: null, name: null, phone: '+919000000002', at: null, formName: null },
  ];

  it('prints names and form names as text, never as markup', () => {
    const out = render(
      <PeopleTable rows={people} who="filled_form" title="Filled a form" when={(i) => i ?? '—'} />,
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('links a matched person to the contact and says when there is no contact', () => {
    const out = render(
      <PeopleTable rows={people} who="came_back" title="Wrote back" when={(i) => i ?? '—'} />,
    );
    expect(out).toContain('href="/contacts/00000000-0000-4000-8000-0000000000c1"');
    expect(out).toContain('Not matched to a contact');
    expect(out).toContain('Name not known');
    expect(out).not.toContain('>Form<');
  });
});

describe('the summary in Arabic', () => {
  it('is translated, with a right-to-left safe layout', () => {
    const out = view({}, 'ar');
    expect(out).toMatch(/[؀-ۿ]/);
    expect(out).not.toContain('Which forms count');
    expect(out).not.toContain('Print summary');
    expect(out).not.toContain('You messaged');
    // Numbers and the chart stay left-to-right inside a right-to-left page; layout uses logical sides only.
    expect(out).toContain('dir="ltr"');
    expect(out).not.toMatch(/\b(ml|mr|pl|pr)-\d|text-left|text-right|\bleft-|\bright-/);
  });

  it('has a headline, tiles and states', () => {
    const empty = view({ state: { isPending: false, isError: true, data: undefined } }, 'ar');
    expect(empty).toMatch(/[؀-ۿ]/);
    expect(empty).not.toContain('Try again');
    const none = view(
      {
        state: {
          isPending: false,
          isError: false,
          data: summaryFixture({
            people: { messaged: 0, delivered: 0, read: 0, failed: 0, notTrackable: 0 },
          }),
        },
      },
      'ar',
    );
    expect(none).not.toContain('Nothing has been sent yet');
  });
});
