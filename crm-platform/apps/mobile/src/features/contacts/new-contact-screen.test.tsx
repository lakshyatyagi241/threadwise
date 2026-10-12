import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { aarav, sessionFull, sessionNoContacts, sessionReadOnly } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { NewContactScreen } from './new-contact-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const createCall = jest.mocked(api.createContact);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
function show() {
  const view = renderApp(<NewContactScreen />);
  client = view.queryClient;
  return view;
}

const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save contact' }));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionFull);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('NewContactScreen', () => {
  it('creates the contact with a cleaned-up phone and opens it', async () => {
    createCall.mockResolvedValue(aarav);
    show();
    await screen.findByLabelText('Name');
    fireEvent.changeText(screen.getByLabelText('Name'), '  Aarav Sharma ');
    fireEvent.changeText(screen.getByLabelText('Phone'), '+91 98123-45678');
    save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        { name: 'Aarav Sharma', phone: '+919812345678' },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/contact/[id]',
        params: { id: aarav.id },
      }),
    );
  });

  it('accepts an email alone', async () => {
    createCall.mockResolvedValue(aarav);
    show();
    fireEvent.changeText(await screen.findByLabelText('Email'), 'aarav@example.test');
    save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({ email: 'aarav@example.test' }, expect.any(String)),
    );
  });

  it('asks for a phone or an email before sending anything', async () => {
    show();
    fireEvent.changeText(await screen.findByLabelText('Name'), 'Aarav');
    save();
    expect(await screen.findByText('Enter a phone number or an email address.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('checks the shape of the phone and the email before sending', async () => {
    show();
    fireEvent.changeText(await screen.findByLabelText('Phone'), '9812345678');
    fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    save();
    expect(
      await screen.findByText(
        'Enter the phone number with the country code, for example +919876543210.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('shows what the server refused under the field', async () => {
    createCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'email', message: 'Invalid email' },
      ]),
    );
    show();
    fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
    save();
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows any other failure above the form, and lets the person try again', async () => {
    createCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    createCall.mockResolvedValueOnce(aarav);
    show();
    fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
    save();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    // A lost connection repeats the same request: the same idempotency key.
    expect(createCall.mock.calls[1]?.[1]).toBe(createCall.mock.calls[0]?.[1]);
  });

  it('goes back on cancel', async () => {
    show();
    fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('is closed to a person who may not add contacts', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    show();
    expect(await screen.findByText("You can't add contacts")).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
    sessionCall.mockResolvedValue(sessionNoContacts);
  });
});
