import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
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
import { reachEnd } from '@/test/scroll';
import * as api from './api';
import { findConversationId } from './chat-api';
import { listContactViews } from './views-api';
import { ContactsScreen } from './contacts-screen';

jest.mock('./api');
jest.mock('./views-api');
jest.mock('./chat-api');
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContacts);
const deleteCall = jest.mocked(api.deleteContact);
const viewsCall = jest.mocked(listContactViews);
const chatCall = jest.mocked(findConversationId);
const sessionRow = {
  ...sessionFull,
  permissions: {
    ...sessionFull.permissions,
    'inbox.conversation.read': 'all',
    'record.tasks.read': 'all',
  },
} as typeof sessionFull;
const sessionAll = {
  ...sessionFull,
  permissions: { ...sessionFull.permissions, 'record.contacts.delete': 'all' },
} as typeof sessionFull;
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactsScreen />);
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
  viewsCall.mockResolvedValue({ data: [], page: { nextCursor: null, hasMore: false, limit: 200 } });
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('ContactsScreen', () => {
  it('lists the contacts with a name, a line under it and the first tag', async () => {
    await show();
    const row = await screen.findByRole('button', { name: 'Aarav Sharma' });
    expect(within(row).getByText('+919812345678 · VIP')).toBeTruthy();
    // Without a name the phone is the name; with only first and last name those are joined.
    const phoneRow = screen.getByRole('button', { name: '+919800000002' });
    expect(within(phoneRow).queryByText(/VIP/)).toBeNull();
    const emailRow = screen.getByRole('button', { name: 'Meera Iyer' });
    expect(within(emailRow).getByText('meera@example.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contact view: All contacts' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith({ limit: 50, cursor: undefined }, expect.anything());
  });

  it('calls a contact with nothing known "Unknown"', async () => {
    listCall.mockResolvedValue(page([nobody]));
    await show();
    expect(await screen.findByRole('button', { name: 'Unknown' })).toBeTruthy();
  });

  it('shows placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof page>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(await screen.findAllByTestId('contact-skeleton-row')).toHaveLength(20);
    await act(async () => finish(page(contacts)));
    expect(await screen.findByRole('button', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.queryAllByTestId('contact-skeleton-row')).toHaveLength(0);
  });

  it('opens a contact when its row is pressed', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Aarav Sharma' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: aarav.id },
    });
  });

  it('asks for the next page when the end is reached, and stops when there is none', async () => {
    listCall.mockResolvedValueOnce(page([aarav], 'cursor-2'));
    listCall.mockResolvedValueOnce(page([phoneOnly]));
    const { queryClient } = await show();
    await screen.findByRole('button', { name: 'Aarav Sharma' });
    await reachEnd(screen.getByTestId('contacts-list'));
    expect(await screen.findByRole('button', { name: '+919800000002' })).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-2' }, expect.anything());
    await settled(queryClient);
    await reachEnd(screen.getByTestId('contacts-list'));
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('reloads the list when the page is pulled down, and stops the spinner when done', async () => {
    const { queryClient } = await show();
    await screen.findByRole('button', { name: 'Aarav Sharma' });
    const control = () => screen.getByTestId('contacts-list').props.refreshControl;
    await act(() => {
      control().props.onRefresh();
    });
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    await settled(queryClient);
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  describe('search', () => {
    it('opens a field under the header and asks the API once the person pauses typing', async () => {
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      expect(screen.queryByLabelText('Search')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Search contacts' }));
      const field = screen.getByLabelText('Search');
      await fireEvent.changeText(field, 'a');
      await fireEvent.changeText(field, 'aa');
      await fireEvent.changeText(field, 'aar');
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
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      await fireEvent.press(screen.getByRole('button', { name: 'Search contacts' }));
      await fireEvent.changeText(screen.getByLabelText('Search'), 'aar');
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
      await fireEvent.press(screen.getByRole('button', { name: 'Close search' }));
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
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      await fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Qualified' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Opted out' }));
      await fireEvent.changeText(screen.getByLabelText('Source'), 'import');
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
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
      await fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      expect(
        screen.getByRole('radio', { name: 'Qualified' }).props.accessibilityState.checked,
      ).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { limit: 50, cursor: undefined },
          expect.anything(),
        ),
      );
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('leaves the list alone when the sheet is cancelled', async () => {
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      await fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Lost' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
      expect(listCall).toHaveBeenCalledTimes(1);
    });
  });

  it('says there are no contacts, and says so differently when a filter is why', async () => {
    listCall.mockResolvedValue(page([]));
    await show();
    expect(await screen.findByText('No contacts')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filter contacts' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Lost' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('No matching contacts')).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells a person without the permission, and asks the API for nothing', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view contacts")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
  });

  describe('the add button', () => {
    it('is there for a person who may add contacts, and opens the form', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Add contact' }));
      expect(router.push).toHaveBeenCalledWith('/contact/new');
    });

    it('is not there for a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionReadOnly);
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
    });
  });

  it('reads each row by the same name the screen shows', async () => {
    listCall.mockResolvedValue(page([emailOnly]));
    await show();
    const row = await screen.findByRole('button', { name: 'Meera Iyer' });
    expect(row.props.accessibilityHint).toBe('meera@example.test');
  });

  describe('the three dots on a row', () => {
    it('opens the shortcuts for that contact, and edit and delete for a person who may', async () => {
      sessionCall.mockResolvedValue(sessionAll);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      expect(await screen.findByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Call' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit contact' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete contact' })).toBeTruthy();
    });

    it('offers no edit or delete to a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionReadOnly);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      expect(await screen.findByRole('button', { name: 'Call' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit contact' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete contact' })).toBeNull();
    });

    it('opens the contact ready to edit', async () => {
      sessionCall.mockResolvedValue(sessionAll);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact/[id]',
        params: { id: aarav.id, edit: '1' },
      });
    });

    it('asks first, deletes, and reloads the list', async () => {
      sessionCall.mockResolvedValue(sessionAll);
      deleteCall.mockResolvedValue(undefined);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Delete contact' }));
      expect(await screen.findByText('Delete Aarav Sharma? This cannot be undone.')).toBeTruthy();
      expect(deleteCall).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(aarav.id));
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
    });

    it('says why a delete failed', async () => {
      sessionCall.mockResolvedValue(sessionAll);
      deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Delete contact' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Delete' }));
      expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    });
  });

  describe('the view picker', () => {
    const savedView = {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Pune leads',
      filter: { op: 'and', conditions: [{ field: 'city', operator: 'eq', value: 'Pune' }] },
      position: 0,
      isShared: true,
      shareMode: 'everyone' as const,
      accessType: 'can_view' as const,
      sharedWith: [],
      canEdit: false,
      canManage: false,
      createdBy: null,
      isFavorite: false,
      rowVersion: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const sessionViews = {
      ...sessionFull,
      permissions: { ...sessionFull.permissions, 'record.contact-views.read': 'all' },
    } as typeof sessionFull;
    const openPicker = async () =>
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Contact view: All contacts' }),
      );

    it('starts on All contacts and lists the built-in views', async () => {
      await show();
      await openPicker();
      expect(await screen.findByRole('header', { name: 'Views' })).toBeTruthy();
      for (const name of ['All contacts', 'My contacts', 'Recently created']) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
      expect(
        screen.getByRole('button', { name: 'All contacts' }).props.accessibilityState.selected,
      ).toBe(true);
    });

    it('shows My contacts: only the ones the signed-in person owns', async () => {
      await show();
      await openPicker();
      await fireEvent.press(await screen.findByRole('button', { name: 'My contacts' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          expect.objectContaining({ ownerId: sessionFull.user.id }),
          expect.anything(),
        ),
      );
      expect(screen.getByRole('button', { name: 'Contact view: My contacts' })).toBeTruthy();
    });

    it('shows the contacts opted out of marketing', async () => {
      await show();
      await openPicker();
      await fireEvent.press(await screen.findByRole('button', { name: 'Opted out of marketing' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          expect.objectContaining({ unsubscribed: true }),
          expect.anything(),
        ),
      );
    });

    it('looks back a week for Recently created', async () => {
      await show();
      await openPicker();
      await fireEvent.press(await screen.findByRole('button', { name: 'Recently created' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          expect.objectContaining({ createdFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
          expect.anything(),
        ),
      );
    });

    it('lists the saved views and applies one as rules text', async () => {
      sessionCall.mockResolvedValue(sessionViews);
      viewsCall.mockResolvedValue({
        data: [savedView],
        page: { nextCursor: null, hasMore: false, limit: 200 },
      });
      await show();
      await openPicker();
      await fireEvent.press(await screen.findByRole('button', { name: 'Pune leads' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          expect.objectContaining({ rules: JSON.stringify(savedView.filter) }),
          expect.anything(),
        ),
      );
      expect(screen.getByRole('button', { name: 'Contact view: Pune leads' })).toBeTruthy();
    });

    it('asks for no saved views from a person who may not read them', async () => {
      await show();
      await openPicker();
      await screen.findByRole('header', { name: 'Views' });
      expect(viewsCall).not.toHaveBeenCalled();
      expect(screen.queryByText('Custom views')).toBeNull();
    });

    it('narrows the views by what is typed, and says when none match', async () => {
      sessionCall.mockResolvedValue(sessionViews);
      viewsCall.mockResolvedValue({
        data: [savedView],
        page: { nextCursor: null, hasMore: false, limit: 200 },
      });
      await show();
      await openPicker();
      await screen.findByRole('button', { name: 'Pune leads' });
      await fireEvent.changeText(screen.getByLabelText('Search views'), 'pune');
      expect(screen.queryByRole('button', { name: 'My contacts' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Pune leads' })).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Search views'), 'zzz');
      expect(await screen.findByText('No views available')).toBeTruthy();
    });

    it('says when the saved views could not be loaded, and still offers the built-in ones', async () => {
      sessionCall.mockResolvedValue(sessionViews);
      viewsCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
      await show();
      await openPicker();
      expect(await screen.findByText("Saved views couldn't be loaded.")).toBeTruthy();
      expect(screen.getByRole('button', { name: 'My contacts' })).toBeTruthy();
    });

    it('closes without changing the view', async () => {
      await show();
      await openPicker();
      await fireEvent.press(await screen.findByRole('button', { name: 'Close views' }));
      await waitFor(() => expect(screen.queryByRole('header', { name: 'Views' })).toBeNull());
      expect(screen.getByRole('button', { name: 'Contact view: All contacts' })).toBeTruthy();
    });
  });

  describe('the shortcuts on a row', () => {
    it('shows only call and chat beside every contact, each named after the contact', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      await show();
      await screen.findByRole('button', { name: 'Aarav Sharma' });
      for (const action of ['Call', 'Chat']) {
        expect(screen.getByRole('button', { name: `${action} Aarav Sharma` })).toBeTruthy();
      }
      for (const action of ['Email', 'SMS', 'Tasks', 'Notes']) {
        expect(screen.queryByRole('button', { name: `${action} Aarav Sharma` })).toBeNull();
      }
    });

    it('hands the call over to the phone', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Call Aarav Sharma' }));
      expect(Linking.openURL).toHaveBeenCalledWith(`tel:${aarav.phone}`);
    });

    it('fades call and chat for a contact with no number', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      await show();
      const call = await screen.findByRole('button', { name: 'Call Meera Iyer' });
      expect(call.props.accessibilityState.disabled).toBe(true);
      expect(
        screen.getByRole('button', { name: 'Chat Meera Iyer' }).props.accessibilityState.disabled,
      ).toBe(true);
      const dialable = screen.getByRole('button', { name: 'Call +919800000002' });
      expect(dialable.props.accessibilityState.disabled).toBeFalsy();
    });

    it('opens the chat that exists, and WhatsApp when there is none', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      chatCall.mockResolvedValueOnce('thread-1').mockResolvedValueOnce(null);
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Chat Aarav Sharma' }));
      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith({
          pathname: '/conversation/[id]',
          params: { id: 'thread-1' },
        }),
      );
      expect(Linking.openURL).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: 'Chat Aarav Sharma' }));
      await waitFor(() =>
        expect(Linking.openURL).toHaveBeenCalledWith(
          `https://wa.me/${aarav.phone!.replace(/\D/g, '')}`,
        ),
      );
    });

    it('says why the chat could not be looked up, under the row', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      chatCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'x'));
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Chat Aarav Sharma' }));
      expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('goes straight to WhatsApp for a person who may not read the inbox', async () => {
      await show();
      const chat = await screen.findByRole('button', { name: 'Chat Aarav Sharma' });
      expect(chat.props.accessibilityState.disabled).toBeFalsy();
      await fireEvent.press(chat);
      expect(chatCall).not.toHaveBeenCalled();
      expect(Linking.openURL).toHaveBeenCalledWith(
        `https://wa.me/${aarav.phone!.replace(/\D/g, '')}`,
      );
    });

    it('still opens the contact from the name, not from an icon', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Aarav Sharma' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact/[id]',
        params: { id: aarav.id },
      });
    });

    it('keeps mail, text, tasks and notes in the three dots', async () => {
      sessionCall.mockResolvedValue(sessionRow);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'More actions for Aarav Sharma' }),
      );
      await fireEvent.press(await screen.findByRole('button', { name: 'Email' }));
      expect(Linking.openURL).toHaveBeenCalledWith(`mailto:${aarav.email}`);
      await fireEvent.press(screen.getByRole('button', { name: 'SMS' }));
      expect(Linking.openURL).toHaveBeenCalledWith(`sms:${aarav.phone}`);
      await fireEvent.press(screen.getByRole('button', { name: 'Tasks' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/tasks',
        params: { contactId: aarav.id },
      });
      await fireEvent.press(screen.getByRole('button', { name: 'Notes' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact-notes',
        params: { contactId: aarav.id },
      });
    });
  });
});
