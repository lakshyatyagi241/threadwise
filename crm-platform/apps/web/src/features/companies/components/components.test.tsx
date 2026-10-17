import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { ERROR_CODES, type CompanyResponse, type SessionResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { visibleColumns } from '../lib/columns';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { ActivityCard } from './activity-card';
import { CompaniesTable, type CompaniesTableProps } from './companies-table';
import { CompaniesToolbar, type CompaniesToolbarProps } from './companies-toolbar';
import { CompanyFormModal } from './company-form-modal';
import { ErrorLine } from './error-line';
import { CompanyLink } from './company-link';
import { CompanyPicker } from './company-picker';
import { LinkedContacts } from './linked-contacts';
import { LinkedDeals } from './linked-deals';
import { DEFAULT_FILTERS } from '../lib/filters';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'companies.json'), 'utf8'),
) as Record<string, unknown>;

const session = (permissions: string[]) =>
  ({
    user: { id: 'u1', fullName: 'Asha Rao', displayName: null },
    org: { timezone: null },
    permissions: Object.fromEntries(permissions.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

const html = (el: ReactElement, permissions: string[] = []) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider session={session(permissions)}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </NextIntlClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );

const company = (over: Partial<CompanyResponse> = {}): CompanyResponse => ({
  id: '294dca7c-5806-4548-9035-dcca9befc7b1',
  displayId: 'COM-00001',
  name: 'Acme Ltd',
  website: 'acme.test',
  email: 'ops@acme.test',
  phone: '+1 555 0100',
  industry: 'Retail',
  sizeRange: '11-50',
  address: '1 Main St',
  notes: 'Key account',
  customFields: {},
  owner: { id: 'u1', name: 'Asha Rao' },
  createdBy: null,
  rollup: {
    contacts: 3,
    deals: {
      total: 4,
      open: 2,
      won: 1,
      openValue: [{ currency: 'USD', amount: '150.50' }],
      wonValue: [
        { currency: 'EUR', amount: '10.00' },
        { currency: 'USD', amount: '40.00' },
      ],
    },
  },
  rowVersion: 3,
  createdAt: '2026-10-05T10:00:00.000Z',
  updatedAt: '2026-10-05T10:00:00.000Z',
  ...over,
});

const tableProps = (over: Partial<CompaniesTableProps> = {}): CompaniesTableProps => ({
  rows: [company()],
  columns: visibleColumns(null, []),
  fields: [],
  selected: new Set(),
  headerState: 'none',
  canDelete: true,
  onToggle: () => undefined,
  onToggleAll: () => undefined,
  onDelete: () => undefined,
  onOpen: () => undefined,
  ...over,
});

describe('CompaniesTable (TW-CTP-002)', () => {
  it('has Reference’s columns and one row per company with its figures, each currency on its own line', () => {
    const out = html(<CompaniesTable {...tableProps()} />);
    for (const col of ['Company', 'Industry', 'Contacts', 'Open deals', 'Won value']) {
      expect(out).toContain(`>${col}</th>`);
    }
    expect(out).toContain('href="/companies/294dca7c-5806-4548-9035-dcca9befc7b1"');
    expect(out).toContain('Acme Ltd');
    expect(out).toContain('Retail');
    expect(out).toContain('€10.00');
    expect(out).toContain('$40.00');
    expect(out).toContain('Delete company');
  });

  it('shows a dash, never a zero, for what the caller may not see, and for a missing industry', () => {
    const out = html(
      <CompaniesTable
        {...tableProps({
          rows: [company({ industry: null, rollup: { contacts: null, deals: null } })],
        })}
      />,
    );
    expect(out.match(/—/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('a company with deals but nothing won reads 0, not a dash', () => {
    const none = company();
    none.rollup.deals!.wonValue = [];
    const out = html(<CompaniesTable {...tableProps({ rows: [none] })} />);
    expect(out).toMatch(/text-muted-foreground">0<\/span>/);
  });

  it('escapes a script in a name', () => {
    const out = html(
      <CompaniesTable
        {...tableProps({ rows: [company({ name: '<script>alert(1)</script>' })] })}
      />,
    );
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('has no selection column and no delete button for someone who may not delete', () => {
    const out = html(<CompaniesTable {...tableProps({ canDelete: false })} />);
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain('Delete company');
  });

  it('marks a ticked row and offers a select-all box', () => {
    const out = html(
      <CompaniesTable {...tableProps({ selected: new Set([company().id]), headerState: 'all' })} />,
    );
    expect(out).toContain('data-selected="true"');
    expect(out).toContain('aria-label="Select all loaded companies"');
    expect(out).toContain('aria-label="Select Acme Ltd"');
  });
});

describe('CompaniesToolbar', () => {
  const props = (over: Partial<CompaniesToolbarProps> = {}): CompaniesToolbarProps => ({
    filters: DEFAULT_FILTERS,
    q: '',
    onQ: () => undefined,
    onChange: () => undefined,
    members: [{ id: 'u1', fullName: 'Asha Rao' }],
    industries: ['Retail', 'Software'],
    onRefresh: () => undefined,
    refreshing: false,
    ...over,
  });

  it('has the search box, the filters and no Clear button while nothing narrows the list', () => {
    const out = html(<CompaniesToolbar {...props()} />);
    expect(out).toContain('placeholder="Search companies…"');
    expect(out).toContain('All industries');
    expect(out).toContain('<option value="Retail">Retail</option>');
    expect(out).toContain('<option value="u1">Asha Rao</option>');
    expect(out).toContain('With open deals');
    expect(out).not.toContain('>Clear<');
  });

  it('shows Clear when a filter or the search text narrows the list', () => {
    expect(html(<CompaniesToolbar {...props({ q: 'acme' })} />)).toContain('>Clear<');
    expect(
      html(<CompaniesToolbar {...props({ filters: { ...DEFAULT_FILTERS, openDeals: true } })} />),
    ).toContain('>Clear<');
  });

  it('keeps an industry from the address that the list of options does not have', () => {
    const out = html(
      <CompaniesToolbar {...props({ filters: { ...DEFAULT_FILTERS, industry: 'Mining' } })} />,
    );
    expect(out).toContain('<option value="Mining" selected="">Mining</option>');
  });
});

describe('CompanyLink (the contact page and the deal drawer)', () => {
  const id = '294dca7c-5806-4548-9035-dcca9befc7b1';

  it('is a link to the company for someone who may read companies', () => {
    const out = html(<CompanyLink id={id} name="Acme Ltd" />, ['record.companies.read']);
    expect(out).toContain(`href="/companies/${id}"`);
    expect(out).toContain('Acme Ltd');
  });

  it('is plain text, not a link, for someone who may not', () => {
    const out = html(<CompanyLink id={id} name="Acme Ltd" />);
    expect(out).not.toContain('<a');
    expect(out).toContain('Acme Ltd');
  });

  it('shows a sentence around the name as the link text', () => {
    const out = html(
      <CompanyLink id={id} name="Acme Ltd">
        Company: Acme Ltd
      </CompanyLink>,
      ['record.companies.read'],
    );
    expect(out).toContain('Company: Acme Ltd</a>');
  });

  it('shows nothing when the name is unknown (not loaded yet, or not readable)', () => {
    for (const perms of [[], ['record.companies.read']]) {
      const out = html(<CompanyLink id={id} />, perms);
      expect(out).not.toContain('<a ');
      expect(out).not.toContain('<span');
    }
  });
});

describe('CompanyFormModal (TW-CTP-003, 004)', () => {
  it('new: Reference’s fields in Reference’s order, the rest under More details, the caller as owner', () => {
    const out = html(<CompanyFormModal onClose={() => undefined} />);
    const order = [
      'Company name *',
      'Industry',
      'Website',
      'Email',
      'Phone',
      'Notes',
      'More details',
    ];
    const at = order.map((label) => out.indexOf(label));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(out).toContain('New company');
    expect(out).toContain('>Create<');
    expect(out).toContain('maxLength="191"');
    expect(out).toContain('maxLength="32"');
    expect(out).toContain('maxLength="2000"');
    expect(out).not.toContain('<details class="group sm:col-span-2" open');
  });

  it('edit: starts from the company and opens the details', () => {
    const out = html(<CompanyFormModal company={company()} onClose={() => undefined} />);
    expect(out).toContain('Edit company');
    expect(out).toContain('value="Acme Ltd"');
    expect(out).toContain('value="ops@acme.test"');
    expect(out).toContain('value="11-50"');
    expect(out).toContain('>Save changes<');
    expect(out).toMatch(/<details[^>]* open/);
  });
});

describe('the company page cards (loading state of each)', () => {
  const id = '294dca7c-5806-4548-9035-dcca9befc7b1';
  it('contacts: the heading, the add button for someone who may link, and a loading line', () => {
    const out = html(<LinkedContacts companyId={id} canLink />);
    expect(out).toContain('Contacts');
    expect(out).toContain('Add contacts');
    expect(out).toContain('Loading contacts');
  });

  it('contacts: no add button for someone who may not link', () => {
    expect(html(<LinkedContacts companyId={id} canLink={false} />)).not.toContain('Add contacts');
  });

  it('deals and activity: heading and a loading line', () => {
    expect(html(<LinkedDeals companyId={id} />)).toContain('Loading deals');
    expect(html(<ActivityCard companyId={id} />)).toContain('Loading activity');
  });
});

describe('ErrorLine: a failed call is described by what failed (BL-034)', () => {
  const notFound = new ApiError(404, ERROR_CODES.NOT_FOUND, 'Not found');

  it('a 404 for one company says the company no longer exists', () => {
    expect(html(<ErrorLine error={notFound} />)).toContain('That company no longer exists.');
  });

  it('a 404 for the list or a search never says so: the route is not available', () => {
    const out = html(<ErrorLine error={notFound} context="list" />);
    expect(out).not.toContain('no longer exists');
    expect(out).toContain('Companies are not available on this server yet.');
  });

  it('a server error and a lost connection keep their own sentences, with a retry button', () => {
    const server = html(
      <ErrorLine
        error={new ApiError(500, 'INTERNAL', 'x')}
        context="list"
        onRetry={() => undefined}
      />,
    );
    expect(server).toContain('Something went wrong. Try again in a moment.');
    expect(server).toContain('Try again</button>');
    const offline = html(<ErrorLine error={new TypeError('Failed to fetch')} context="list" />);
    expect(offline).toContain('Could not reach the server.');
    expect(offline).not.toContain('no longer exists');
  });
});

describe('CompanyPicker (the company field of the contact and deal forms)', () => {
  const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
  const noop = () => undefined;

  it('with nothing chosen it is a search box (a combobox) that offers no list until it is used', () => {
    const out = html(<CompanyPicker value={null} onChange={noop} id="f-company" />);
    expect(out).toContain('role="combobox"');
    expect(out).toContain('placeholder="Search companies"');
    expect(out).toContain('id="f-company"');
    expect(out).not.toContain('role="listbox"');
  });

  it('with a company chosen it shows the name, escaped, and a button that removes it', () => {
    const out = html(
      <CompanyPicker value={{ id: ID, name: '<script>x</script> Acme' }} onChange={noop} />,
    );
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt; Acme');
    expect(out).not.toContain('<script>');
    expect(out).toContain('aria-label="Remove the company"');
    expect(out).not.toContain('role="combobox"');
  });

  it('read-only (disabled): the name stays, the remove button goes', () => {
    const out = html(<CompanyPicker value={{ id: ID, name: 'Acme' }} onChange={noop} disabled />);
    expect(out).toContain('Acme');
    expect(out).not.toContain('Remove the company');
  });

  it('a drawer can make the name a link to the company; a form does not (leaving would lose what was typed)', () => {
    const linked = html(
      <CompanyPicker value={{ id: ID, name: 'Acme' }} onChange={noop} linkToCompany />,
    );
    expect(linked).toContain(`href="/companies/${ID}"`);
    expect(html(<CompanyPicker value={{ id: ID, name: 'Acme' }} onChange={noop} />)).not.toContain(
      'href=',
    );
  });

  it('a company known only by id says it is loading until its name arrives', () => {
    expect(
      html(<CompanyPicker value={{ id: ID }} onChange={noop} />, ['record.companies.read']),
    ).toContain('Loading company');
  });
});
