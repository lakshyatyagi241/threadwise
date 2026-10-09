import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiLibraryDetail, ApiLibraryItem, ApiLibraryLogItem } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

const q = <T,>(over: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isError: false,
    error: null,
    data: undefined as T | undefined,
    refetch: () => undefined,
    ...over,
  }) as never;

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  list: {} as Record<string, unknown>,
  usage: {} as Record<string, unknown>,
  detail: {} as Record<string, unknown>,
  logs: {} as Record<string, unknown>,
  options: {} as Record<string, unknown>,
  query: '',
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/api-library',
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock('../api/hooks', () => ({
  KEYS: { detail: (id: string) => ['d', id], all: ['api-library'] },
  refreshApis: () => undefined,
  useApiList: () => state.list,
  useApiUsage: () => state.usage,
  useApiDetail: () => state.detail,
  useApiLogs: () => state.logs,
  useApiLog: () => q(),
  useApiLibraryOptions: () => state.options,
  useContactProperties: () =>
    q({ data: { data: [{ key: 'email', label: 'Email', kind: 'system' }] } }),
}));

import { ApiFormScreen } from './api-form-screen';
import { ApiListScreen, ApiTable } from './api-list-screen';
import { DeleteApiDialog } from './delete-api-dialog';
import { LogsPanel } from './logs-panel';
import { LogsScreen } from './logs-screen';
import { PageHeader } from './page-chrome';
import { Pagination } from './pagination';
import { ResponseTree } from './response-tree';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'api-library.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const ID = '00000000-0000-4000-8000-000000000001';
const item = (over: Partial<ApiLibraryItem> = {}): ApiLibraryItem => ({
  id: ID,
  name: 'Orders',
  method: 'POST',
  url: 'https://api.example.com/orders',
  payloadType: 'application/json',
  hasFunction: false,
  createdAt: '2026-03-05T10:00:00.000Z',
  updatedAt: '2026-03-06T10:00:00.000Z',
  rowVersion: 2,
  ...over,
});
/** A numbered list answer as the hooks return it: `total` is every row, `items` only this page. */
const listOf = <T,>(
  items: T[],
  over: Record<string, unknown> = {},
  paging: { total?: number; totalPages?: number; page?: number; pageSize?: number } = {},
) => ({
  data: {
    data: items,
    total: paging.total ?? items.length,
    totalPages: paging.totalPages ?? 1,
    page: paging.page ?? 1,
    pageSize: paging.pageSize ?? 25,
  },
  isPending: false,
  isError: false,
  isSuccess: true,
  isFetching: false,
  isPlaceholderData: false,
  error: null,
  refetch: () => undefined,
  ...over,
});
const paging = { page: 1, limit: 25 as const, setPage: () => undefined, setLimit: () => undefined };

const ALL = [
  'integ.apilibrary.read',
  'integ.apilibrary.create',
  'integ.apilibrary.update',
  'integ.apilibrary.delete',
  'integ.apilibrary.test',
];

beforeEach(() => {
  state.perms = new Set(ALL);
  state.list = listOf([item()]);
  state.usage = q({ data: { data: [] } });
  state.logs = listOf([]);
  state.options = q({ data: { data: [] } });
  state.detail = q();
});

describe('API list screen', () => {
  it('shows the columns of the old console, the rows and every action to a full-access role', () => {
    const out = html(<ApiListScreen />);
    for (const h of ['Name', 'Method', 'URL', 'Created', 'Modified', 'Logs', 'Actions'])
      expect(out).toContain(h);
    expect(out).toContain('Orders');
    expect(out).toContain('Import API&#x27;s');
    expect(out).toContain('href="/api-library/new"');
    expect(out).toContain('aria-label="Actions for Orders"');
    expect(out).toContain('aria-label="Copy the URL of Orders"');
    expect(out).toContain('https://api.example.com/orders');
    expect(out).toContain('1 API');
    expect(out).toContain('title="Mar 5, 2026, 10:00 AM"');
  });

  it('hides Create, Import and Delete from a role that may only read', () => {
    state.perms = new Set(['integ.apilibrary.read']);
    const out = html(<ApiListScreen />);
    expect(out).toContain('Orders');
    expect(out).not.toContain('href="/api-library/new"');
    expect(out).not.toContain('Import API');
    expect(out).toContain('aria-label="Actions for Orders"');
  });

  it('says there is no access without the read permission', () => {
    state.perms = new Set();
    const out = html(<ApiListScreen />);
    expect(out).toContain('You do not have access to the API Library.');
    expect(out).not.toContain('Orders');
  });

  it('shows the empty state with Create API, and none for a role that cannot create', () => {
    state.list = listOf([]);
    const out = html(<ApiListScreen />);
    expect(out).toContain('No APIs yet');
    expect(out).toContain('Create API');
    state.perms = new Set(['integ.apilibrary.read']);
    expect(html(<ApiListScreen />)).not.toContain('Create API');
  });

  it('shows loading and error states', () => {
    state.list = { ...listOf([]), data: undefined, isPending: true, isSuccess: false };
    const loading = html(<ApiListScreen />);
    expect(loading).not.toContain('No APIs yet');
    expect(loading).toContain('animate-pulse');
    state.list = { ...listOf([]), data: undefined, isError: true, isSuccess: false };
    expect(html(<ApiListScreen />)).toContain('Try again');
  });

  it('pages with numbers, not Load more, and reads the page and size from the URL', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      item({ id: `${ID.slice(0, -2)}${i}0`, name: `Api${i}` }),
    );
    state.query = 'page=3&limit=10';
    state.list = listOf(rows, {}, { total: 53, totalPages: 6, page: 3, pageSize: 10 });
    const out = html(<ApiListScreen />);
    expect(out).not.toContain('Load more');
    expect(out).toContain('Showing 21-30 of 53');
    expect(out).toContain(
      'aria-label="Go to page 3" aria-current="page"'.replace(' aria-current="page"', ''),
    );
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('53 APIs');
    expect(out).toContain('Rows per page');
    state.query = '';
  });

  it('dims the rows while the next page loads and keeps them on screen', () => {
    state.list = listOf([item()], { isPlaceholderData: true, isFetching: true });
    const out = html(<ApiListScreen />);
    expect(out).toContain('opacity-60');
    expect(out).toContain('Orders');
    expect(out).toContain('Loading the page');
  });

  it('shows the empty state only when the whole list is empty, not on a page past the end', () => {
    state.list = listOf([], {}, { total: 53, totalPages: 3, page: 9 });
    expect(html(<ApiListScreen />)).not.toContain('No APIs yet');
  });

  it('labels every row action with the API name', () => {
    const out = html(
      <ApiTable
        rows={[item()]}
        canUpdate
        canDelete
        onLogs={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(out).toContain('aria-label="Logs of Orders"');
    expect(out).toContain('aria-label="Actions for Orders"');
    expect(out).toContain('<time');
  });
});

describe('delete with the usage guard', () => {
  const api = { id: ID, name: 'Orders' };

  it('asks plainly when no flow uses the API', () => {
    const out = html(<DeleteApiDialog api={api} onClose={() => undefined} />);
    expect(out).toContain('Are you sure you want to delete Orders?');
    expect(out).toContain('>Delete<');
    expect(out).not.toContain('Delete anyway');
  });

  it('lists the flows and offers Delete anyway when some use it', () => {
    state.usage = q({
      data: {
        data: [{ kind: 'flow', id: 'f1', name: 'Welcome flow', published: true, nodeCount: 2 }],
      },
    });
    const out = html(<DeleteApiDialog api={api} onClose={() => undefined} />);
    expect(out).toContain('1 flow uses this API');
    expect(out).toContain('Welcome flow');
    expect(out).toContain('href="/flows/builder/f1"');
    expect(out).toContain('2 steps');
    expect(out).toContain('Delete anyway');
  });

  it('waits for the check before it lets the person confirm', () => {
    state.usage = q({ isPending: true });
    const out = html(<DeleteApiDialog api={api} onClose={() => undefined} />);
    expect(out).toContain('Checking which flows use it');
    expect(out).toMatch(/disabled=""[^>]*>[^<]*(<!-- -->)?Delete</);
  });
});

describe('logs', () => {
  const log = (over: Partial<ApiLibraryLogItem> = {}): ApiLibraryLogItem => ({
    id: '00000000-0000-4000-8000-0000000000aa',
    apiId: ID,
    apiName: 'Orders',
    source: 'flow',
    method: 'POST',
    url: 'https://api.example.com/orders',
    ok: false,
    statusCode: 500,
    durationMs: 1500,
    errorKind: 'status',
    error: 'HTTP 500',
    createdAt: '2026-03-05T10:00:00.000Z',
    ...over,
  });

  it('lists runs with status, source, duration and the API column on the full page only', () => {
    state.logs = listOf([log()]);
    const page = html(<LogsPanel paging={paging} />);
    expect(page).toContain('Requested on');
    expect(page).toContain('>API<');
    expect(page).toContain('500');
    expect(page).toContain('1.50 s');
    expect(page).toContain('Flow');
    expect(page).toContain('HTTP 500');
    expect(html(<LogsPanel apiId={ID} paging={paging} />)).not.toContain('>API</th>');
  });

  it('has the filters of the old drawer and the new ones', () => {
    const out = html(<LogsPanel paging={paging} apis={[{ id: ID, name: 'Orders' }]} />);
    for (const label of ['Search', 'Result', 'Status code', 'Source', 'From', 'To', 'All APIs'])
      expect(out).toContain(label);
  });

  it('shows empty and error states', () => {
    state.logs = listOf([]);
    expect(html(<LogsPanel paging={paging} />)).toContain('No runs yet');
    state.logs = listOf([], { isError: true });
    expect(html(<LogsPanel paging={paging} />)).toContain('Try again');
  });

  it('the logs page needs the read permission', () => {
    state.perms = new Set();
    expect(html(<LogsScreen />)).toContain('You do not have access to the API logs.');
  });
});

describe('response tree', () => {
  const props = {
    flowPaths: [] as string[],
    mappingPaths: [] as string[],
    onAdd: () => undefined,
    onRemove: () => undefined,
  };

  it('offers a pick on every value and shows what is already picked', () => {
    const out = html(
      <ResponseTree
        {...props}
        flowPaths={['data.items[].name']}
        mappingPaths={['data.id']}
        json={{ data: { id: 7, items: [{ name: 'a', price: 3 }] } }}
      />,
    );
    // already picked (the every-item form covers this item): a minus, not a plus
    expect(out).toContain('aria-label="Use data.items[0].price"');
    expect(out).toContain('aria-label="Stop using data.items[0].name"');
    expect(out).toContain('aria-label="Stop using data.id"');
    expect(out).toContain('Flow');
    expect(out).toContain('Contact');
  });

  it('cannot pick a key the path syntax cannot hold', () => {
    const out = html(<ResponseTree {...props} json={{ 'a b': 1 }} />);
    expect(out).toContain('path not supported');
  });
});

describe('create / edit form', () => {
  const detail = (over: Partial<ApiLibraryDetail> = {}): ApiLibraryDetail => ({
    ...item(),
    variables: [{ name: 'order_id', source: 'contact', defaultValue: '5' }],
    headers: [
      { key: 'Authorization', value: '********', secret: true },
      { key: 'X-Plain', value: 'ok', secret: false },
    ],
    body: { id: '{{order_id}}' },
    functionCode: null,
    mapping: [{ path: 'data.id', contactProperty: 'email', defaultValue: '' }],
    responseVariables: ['data.id'],
    createdById: null,
    url: 'https://api.example.com/orders/{{order_id}}',
    ...over,
  });

  it('refuses a role without the create permission', () => {
    state.perms = new Set(['integ.apilibrary.read']);
    expect(html(<ApiFormScreen />)).toContain('You do not have access to this screen.');
  });

  it('renders every field of the old form on the new screen', () => {
    const out = html(<ApiFormScreen />);
    for (const label of [
      'Create API',
      'API name',
      'Method',
      'URL',
      'Headers',
      'Add header',
      'Run test',
      'Save',
      'Response mapping',
      'Response variables',
    ])
      expect(out).toContain(label);
    // a GET has no payload editor yet
    expect(out).not.toContain('Payload content');
    expect(out).not.toContain('Unsaved changes');
  });

  it('loads an API for edit: name locked, secret masked and kept, token declared', () => {
    state.detail = q({ data: detail() });
    const out = html(<ApiFormScreen id={ID} />);
    expect(out).toContain('Edit Orders');
    expect(out).toMatch(/id="alib-name"[^>]*disabled/);
    expect(out).toContain('value="********"');
    expect(out).toContain('The saved value is kept.');
    expect(out).toContain('Replace');
    expect(out).toContain('Secret by its name');
    expect(out).toContain('{{order_id}}');
    expect(out).toContain('value="5"');
    expect(out).toContain('Payload content');
    expect(out).toContain('Valid JSON.');
    expect(out).toContain('Update');
    expect(out).toContain('data.id');
  });

  it('is read-only for a role that may not update, and has no Update button', () => {
    state.perms = new Set(['integ.apilibrary.read']);
    state.detail = q({ data: detail() });
    const out = html(<ApiFormScreen id={ID} />);
    expect(out).toContain('You can view this API but not change it.');
    expect(out).not.toContain('>Update<');
    expect(out).toContain('You need permission to test APIs to run a test.');
  });

  it('shows loading and load errors for an existing API', () => {
    state.detail = q({ isPending: true });
    expect(html(<ApiFormScreen id={ID} />)).not.toContain('Edit ');
    state.detail = q({ isError: true });
    expect(html(<ApiFormScreen id={ID} />)).toContain('Try again');
  });

  it('shows the function editor with Run code when the API has a function', () => {
    state.detail = q({ data: detail({ functionCode: 'function processPayload(p){return p}' }) });
    const out = html(<ApiFormScreen id={ID} />);
    expect(out).toContain('Function to handle the payload');
    expect(out).toContain('Run code');
  });
});

describe('header back button', () => {
  it('is an icon-only link before the icon tile and the title, named for where it goes', () => {
    const out = html(
      <PageHeader
        icon={<span>I</span>}
        title="Logs"
        back={{ href: '/api-library', label: 'Back to API Library' }}
      />,
    );
    expect(out).toContain('href="/api-library"');
    expect(out).toContain('aria-label="Back to API Library"');
    expect(out).toContain('title="Back to API Library"');
    expect(out).toContain('size-10');
    expect(out.indexOf('Back to API Library')).toBeLessThan(out.indexOf('<h1'));
    expect(out.indexOf('Back to API Library')).toBeLessThan(out.indexOf('>I<'));
    // no stacked text link above the title any more
    expect(out).not.toMatch(/>\s*Back to API Library\s*</);
  });

  it('is absent on a page with no parent', () => {
    const out = html(<PageHeader icon={<span>I</span>} title="API Library" />);
    expect(out).not.toContain('<a ');
    expect(out).toContain('API Library');
  });

  it('the logs page and the forms use it', () => {
    expect(html(<LogsScreen />)).toContain('aria-label="Back to API Library"');
    expect(html(<ApiFormScreen />)).toContain('aria-label="Back to API Library"');
  });
});

describe('Pagination', () => {
  const render = (over: Partial<Parameters<typeof Pagination>[0]> = {}) =>
    html(
      <Pagination
        page={5}
        totalPages={20}
        total={500}
        pageSize={25}
        rows={25}
        onPage={() => undefined}
        onPageSize={() => undefined}
        {...over}
      />,
    );

  it('shows the range, numbered pages with ellipsis, the current page and the phone summary', () => {
    const out = render();
    expect(out).toContain('Showing 101-125 of 500');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('aria-label="Go to page 20"');
    expect(out).toContain('…');
    expect(out).toContain('Page 5 of 20');
    expect(out).toContain('aria-label="Previous page"');
    expect(out).toContain('aria-label="Next page"');
  });

  it('offers 10, 25, 50 and 100 rows per page with the current one selected', () => {
    const out = render();
    for (const n of [10, 25, 50, 100]) expect(out).toContain(`${n} per page`);
    expect(out).toMatch(/<option value="25" selected/);
  });

  it('disables Previous on the first page and Next on the last', () => {
    expect(render({ page: 1 })).toMatch(/disabled=""[^>]*aria-label="Previous page"/);
    expect(render({ page: 20 })).toMatch(/disabled=""[^>]*aria-label="Next page"/);
    expect(render({ page: 5 })).not.toMatch(/disabled=""[^>]*aria-label="(Previous|Next) page"/);
  });

  it('says there is nothing to show for an empty list, and names the last short page', () => {
    expect(render({ page: 1, totalPages: 1, total: 0, rows: 0 })).toContain('Nothing to show');
    expect(render({ page: 3, totalPages: 3, total: 53, rows: 3 })).toContain('Showing 51-53 of 53');
  });

  it('marks a count that hit the cap', () => {
    expect(render({ total: 100000, totalPages: 4000 })).toContain('of 100,000+');
  });

  it('says a page is loading and carries a note', () => {
    const out = render({ fetching: true, note: 'Runs are kept for 30 days.' });
    expect(out).toContain('Loading the page');
    expect(out).toContain('Runs are kept for 30 days.');
  });
});
