import type { ContactResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { fetchSession } from '@/lib/session/api';
import { aarav } from '@/test/contacts-fixtures';
import { companyA, contactDeals, sessionFull } from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import { getCompany } from './company-api';
import { listContactDeals } from './deals-api';
import { MoreTab } from './more-tab';

jest.mock('./company-api');
jest.mock('./deals-api');
jest.mock('@/lib/session/api');
jest.mock('./files-tab', () => ({
  FilesTab: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require('@/components/ui/text');
    return <Text>files tab</Text>;
  },
}));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const companyCall = jest.mocked(getCompany);
const dealsCall = jest.mocked(listContactDeals);
const router = { push: jest.fn() };
const sessionAll = {
  ...sessionFull,
  permissions: {
    ...sessionFull.permissions,
    'record.deals.read': 'all',
    'record.companies.read': 'all',
  },
} as typeof sessionFull;
const withCompany = { ...aarav, companyId: companyA.id };

let client: QueryClient | undefined;
async function show(contact: ContactResponse = withCompany) {
  const view = await renderApp(<MoreTab contact={contact} canUpdate />);
  client = view.queryClient;
  return view;
}
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  sessionCall.mockResolvedValue(sessionAll);
  companyCall.mockResolvedValue(companyA);
  dealsCall.mockResolvedValue(contactDeals);
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('MoreTab', () => {
  it('names the account and counts the deals, and still shows the files', async () => {
    await show();
    expect(await screen.findByRole('button', { name: 'Account, Apex IQ' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Deals, 3' })).toBeTruthy();
    expect(screen.getByText('files tab')).toBeTruthy();
  });

  it('opens the account and the deals of the contact', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Account, Apex IQ' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact-company',
      params: { companyId: companyA.id, contactId: aarav.id },
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Deals, 3' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact-deals',
      params: { contactId: aarav.id },
    });
  });

  it('has no account row for a contact without a company, and asks nothing for it', async () => {
    const { queryClient } = await show({ ...aarav, companyId: null });
    expect(await screen.findByRole('button', { name: 'Deals, 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Account/ })).toBeNull();
    await settled(queryClient);
    expect(companyCall).not.toHaveBeenCalled();
  });

  it('shows only the files, and asks for nothing, to a person who may read neither', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    const { queryClient } = await show();
    expect(await screen.findByText('files tab')).toBeTruthy();
    await settled(queryClient);
    expect(screen.queryByRole('button', { name: /Deals/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Account/ })).toBeNull();
    expect(companyCall).not.toHaveBeenCalled();
    expect(dealsCall).not.toHaveBeenCalled();
  });
});
