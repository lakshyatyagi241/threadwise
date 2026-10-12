import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  aarav,
  phoneOnly,
  sessionFull,
  sessionNoContacts,
  sessionReadOnly,
  vipTag,
} from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { ContactDetailScreen } from './contact-detail-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getContact);
const tagsCall = jest.mocked(api.getContactTags);
const updateCall = jest.mocked(api.updateContact);
const attachCall = jest.mocked(api.attachContactTag);
const detachCall = jest.mocked(api.detachContactTag);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactDetailScreen />);
  client = view.queryClient;
  return view;
}

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: aarav.id });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionFull);
  getCall.mockResolvedValue(aarav);
  tagsCall.mockResolvedValue([vipTag]);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('ContactDetailScreen', () => {
  it('shows who the contact is and where they stand', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
    expect(getCall).toHaveBeenCalledWith(aarav.id, expect.anything());
    expect(screen.getByText('Qualified')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('import')).toBeTruthy();
    expect(screen.getByText('Subscribed')).toBeTruthy();
    expect(screen.getByText('Can receive')).toBeTruthy();
    expect(screen.getByText('Pune')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(await screen.findByText('VIP')).toBeTruthy();
  });

  it('opens the dialler and the mail app from the phone and the email', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('link', { name: 'Call +919812345678' }));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+919812345678');
    await fireEvent.press(screen.getByRole('link', { name: 'Write to aarav@example.test' }));
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:aarav@example.test');
  });

  it('leaves out what the contact does not have', async () => {
    getCall.mockResolvedValue(phoneOnly);
    tagsCall.mockResolvedValue([]);
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: phoneOnly.id });
    await show();
    expect(await screen.findByRole('link', { name: 'Call +919800000002' })).toBeTruthy();
    expect(screen.queryByText('Email')).toBeNull();
    expect(screen.queryByText('Custom fields')).toBeNull();
    expect(await screen.findByText('No tags yet.')).toBeTruthy();
  });

  it('goes back, to the list when there is nowhere to go back to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith('/contacts');
  });

  it('says so when the contact no longer exists', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });

  it('shows the failure with a way to try again', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
  });

  it('tells a person without the permission, and asks for nothing', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view contacts")).toBeTruthy();
    await settled(queryClient);
    expect(getCall).not.toHaveBeenCalled();
    expect(tagsCall).not.toHaveBeenCalled();
  });

  describe('editing', () => {
    it('opens the form filled in, and sends only what changed with the row version', async () => {
      updateCall.mockResolvedValue({ ...aarav, name: 'Aarav S.', rowVersion: 4 });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      expect(screen.getByLabelText('Name').props.value).toBe('Aarav Sharma');
      expect(screen.getByLabelText('Phone').props.value).toBe('+919812345678');
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Aarav S.');
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(updateCall).toHaveBeenCalledWith(
          aarav.id,
          { name: 'Aarav S.', rowVersion: 3 },
          expect.any(String),
        ),
      );
      // Back on the card, showing the saved version.
      expect(await screen.findByRole('header', { name: 'Aarav S.' })).toBeTruthy();
    });

    it('sends an emptied field as null', async () => {
      updateCall.mockResolvedValue({ ...aarav, email: null });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      await fireEvent.changeText(screen.getByLabelText('Email'), '');
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(updateCall).toHaveBeenCalledWith(
          aarav.id,
          { email: null, rowVersion: 3 },
          expect.any(String),
        ),
      );
    });

    it('reloads the contact and asks for another look when someone else saved first', async () => {
      updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      getCall.mockResolvedValue({ ...aarav, name: 'Aarav Verma', rowVersion: 4 });
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Aarav S.');
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(
        await screen.findByText('This contact was changed by someone else. Review and save again.'),
      ).toBeTruthy();
      expect(getCall).toHaveBeenCalledTimes(2);
      // The form now holds the other person's version, and saving again carries the new row version.
      await waitFor(() => expect(screen.getByLabelText('Name').props.value).toBe('Aarav Verma'));
      updateCall.mockResolvedValue({ ...aarav, name: 'Aarav S.', rowVersion: 5 });
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Aarav S.');
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(updateCall).toHaveBeenLastCalledWith(
          aarav.id,
          { name: 'Aarav S.', rowVersion: 4 },
          expect.any(String),
        ),
      );
    });

    it('shows what the server refused under the field', async () => {
      updateCall.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
          { path: 'phone', message: 'bad' },
        ]),
      );
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      await fireEvent.changeText(screen.getByLabelText('Phone'), '+910000000');
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(
        await screen.findByText(
          'Enter the phone number with the country code, for example +919876543210.',
        ),
      ).toBeTruthy();
      expect(updateCall).toHaveBeenCalledTimes(1);
    });

    it('closes without a request when nothing changed, and on cancel', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Edit contact' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(updateCall).not.toHaveBeenCalled();
      expect(await screen.findByRole('header', { name: 'Aarav Sharma' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Edit contact' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });

    it('is not offered to a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionReadOnly);
      await show();
      await screen.findByRole('header', { name: 'Aarav Sharma' });
      expect(screen.queryByRole('button', { name: 'Edit contact' })).toBeNull();
      expect(screen.queryByLabelText('Add a tag')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove tag VIP' })).toBeNull();
    });
  });

  describe('tags', () => {
    it('adds a tag by name', async () => {
      attachCall.mockResolvedValue({ ...vipTag, name: 'Hot' });
      await show();
      await screen.findByText('VIP');
      await fireEvent.changeText(screen.getByLabelText('Add a tag'), ' Hot ');
      await fireEvent.press(screen.getByRole('button', { name: 'Add tag' }));
      await waitFor(() =>
        expect(attachCall).toHaveBeenCalledWith(aarav.id, 'Hot', expect.any(String)),
      );
      await waitFor(() => expect(screen.getByLabelText('Add a tag').props.value).toBe(''));
    });

    it('removes a tag', async () => {
      detachCall.mockResolvedValue(undefined);
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Remove tag VIP' }));
      await waitFor(() => expect(detachCall).toHaveBeenCalledWith(aarav.id, vipTag.id));
    });

    it('says when a tag could not be added', async () => {
      attachCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
      await show();
      await screen.findByText('VIP');
      await fireEvent.changeText(screen.getByLabelText('Add a tag'), 'Hot');
      await act(async () => await fireEvent.press(screen.getByRole('button', { name: 'Add tag' })));
      expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    });
  });
});
