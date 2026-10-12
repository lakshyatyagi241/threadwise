import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  aarav,
  contacts,
  emailOnly,
  nobody,
  page,
  phoneOnly,
  sessionFull,
  sessionNoContacts,
  sessionReadOnly,
} from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { ContactsScreen } from './contacts-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContacts);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
function show() {
  const view = renderApp(<ContactsScreen />);
  client = view.queryClient;
  return view;
}

/** Waits until every request has finished, so no update lands after the test. */
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  sessionCall.mockResolvedValue(sessionFull);
  listCall.mockResolvedValue(page(contacts));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('ContactsScreen', () => {
  it('lists the contacts with a name, a line under it and the first tag', async () => {
    show();
    const row = await screen.findByRole('button', { name: 'Aarav Sharma' });
    expect(within(row).getByText('+919812345678')).toBeTruthy();
    expect(within(row).getByText('VIP')).toBeTruthy();
    // Without a name the phone is the name; with only first and last name those are joined.
    const phoneRow = screen.getByRole('button', { name: '+919800000002' });
    expect(within(phoneRow).queryByText('VIP')).toBeNull();
    const emailRow = screen.getByRole('button', { name: 'Meera Iyer' });
    expect(within(emailRow).getByText('meera@example.test')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Contacts' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith({ limit: 50, cursor: undefined }, expect.anything());
  });

  it('calls a contact with nothing known "Unknown"', async () => {
    listCall.mockResolvedValue(page([nobody]));
    show();
    expect(await screen.findByRole('button', { name: 'Unknown' })).toBeTruthy();
  });

  it('shows placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof page>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    expect(await screen.findAllByTestId('contact-skeleton-row')).toHaveLength(20);
    await act(async () => finish(page(contacts)));
    expect(await screen.findByRole('button', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.queryAllByTestId('contact-skeleton-row')).toHaveLength(0);
  });

  it('opens a contact when its row is pressed', async () => {
    show();
    fireEvent.press(await screen.findByRole('button', { name: 'Aarav Sharma' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: aarav.id },
    });
  });

  it('asks for the next page when the end is reached, and stops when there is none', async () => {
    listCall.mockResolvedValueOnce(page([aarav], 'cursor-2'));
    listCall.mockResolvedValueOnce(page([phoneOnly]));
    const { queryClient } = show();
    await screen.findByRole('button', { name: 'Aarav Sharma' });
    await act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached());
    expect(await screen.findByRole('button', { name: '+919800000002' })).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-2' }, expect.anything());
    await settled(queryClient);
    await act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached());
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('reloads the list when the page is pulled down, and stops the spinner when done', async () => {
    const { queryClient } = show();
    await screen.findByRole('button', { name: 'Aarav Sharma' });
    const control = () => screen.UNSAFE_getByType(FlatList).props.refreshControl;
    act(() => {
      control().props.onRefresh();
    });
    expect(control().props.refreshing).toBe(true);
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    await settled(queryClient);
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  describe('search', () => {
    it('opens a field under the header and asks the API once the person pauses typing', async () => {
      show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      expect(screen.queryByLabelText('Search')).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: 'Search contacts' }));
      const field = screen.getByLabelText('Search');
      fireEvent.changeText(field, 'a');
      fireEvent.changeText(field, 'aa');
      fireEvent.changeText(field, 'aar');
      // Nothing is asked while the person is still typing.
      expect(listCall).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { limit: 50, cursor: undefined, q: 'aar' },
          expect.anything(),
        ),
      );
      expect(listCall).toHaveBeenCalledTimes(2);
    });

    it('closing the search clears it and shows everyone again', async () => {
      show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      fireEvent.press(screen.getByRole('button', { name: 'Search contacts' }));
      fireEvent.changeText(screen.getByLabelText('Search'), 'aar');
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
      fireEvent.press(screen.getByRole('button', { name: 'Close search' }));
      expect(screen.queryByLabelText('Search')).toBeNull();
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { limit: 50, cursor: undefined },
          expect.anything(),
        ),
      );
    });
  });

  describe('filters', () => {
    it('applies the chosen filters, remembers them in the sheet, and clears them all', async () => {
      show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      fireEvent.press(screen.getByRole('radio', { name: 'Qualified' }));
      fireEvent.press(screen.getByRole('radio', { name: 'Opted out' }));
      fireEvent.changeText(screen.getByLabelText('Source'), 'import');
      fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          {
            limit: 50,
            cursor: undefined,
            lifecycleStage: 'qualified',
            source: 'import',
            unsubscribed: true,
          },
          expect.anything(),
        ),
      );
      expect(screen.queryByRole('radio', { name: 'Qualified' })).toBeNull();

      // The sheet opens on what is applied, and "Clear all" removes every filter at once.
      fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      expect(
        screen.getByRole('radio', { name: 'Qualified' }).props.accessibilityState.checked,
      ).toBe(true);
      fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { limit: 50, cursor: undefined },
          expect.anything(),
        ),
      );
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('leaves the list alone when the sheet is cancelled', async () => {
      show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      fireEvent.press(screen.getByRole('radio', { name: 'Lost' }));
      fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
      expect(listCall).toHaveBeenCalledTimes(1);
    });
  });

  it('says there are no contacts, and says so differently when a filter is why', async () => {
    listCall.mockResolvedValue(page([]));
    show();
    expect(await screen.findByText('No contacts')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Lost' }));
    fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('No matching contacts')).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells a person without the permission, and asks the API for nothing', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = show();
    expect(await screen.findByText("You can't view contacts")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
  });

  describe('the add button', () => {
    it('is there for a person who may add contacts, and opens the form', async () => {
      show();
      fireEvent.press(await screen.findByRole('button', { name: 'Add contact' }));
      expect(router.push).toHaveBeenCalledWith('/contact/new');
    });

    it('is not there for a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionReadOnly);
      show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
    });
  });

  it('reads each row by the same name the screen shows', async () => {
    listCall.mockResolvedValue(page([emailOnly]));
    show();
    const row = await screen.findByRole('button', { name: 'Meera Iyer' });
    expect(row.props.accessibilityHint).toBe('meera@example.test');
  });
});
