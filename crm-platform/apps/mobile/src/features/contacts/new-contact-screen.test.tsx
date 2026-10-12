import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { field, option } from '@/test/contact-properties-fixtures';
import { aarav, sessionFull, sessionNoContacts, sessionReadOnly } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { NewContactScreen } from './new-contact-screen';
import { listContactFieldDependencies, listContactFields } from './properties-api';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const createCall = jest.mocked(api.createContact);
const fieldsCall = jest.mocked(listContactFields);
const dependenciesCall = jest.mocked(listContactFieldDependencies);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<NewContactScreen />);
  client = view.queryClient;
  return view;
}

const save = async () =>
  await fireEvent.press(screen.getByRole('button', { name: 'Save contact' }));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionFull);
  fieldsCall.mockResolvedValue([]);
  dependenciesCall.mockResolvedValue([]);
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
    await show();
    await screen.findByLabelText('Name');
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Aarav Sharma ');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+91 98123-45678');
    await save();
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
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'aarav@example.test');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({ email: 'aarav@example.test' }, expect.any(String)),
    );
  });

  it('asks for a phone or an email before sending anything', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Aarav');
    await save();
    expect(await screen.findByText('Enter a phone number or an email address.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('checks the shape of the phone and the email before sending', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Phone'), '9812345678');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await save();
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
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
    await save();
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows any other failure above the form, and lets the person try again', async () => {
    createCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    createCall.mockResolvedValueOnce(aarav);
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
    await save();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    // A lost connection repeats the same request: the same idempotency key.
    expect(createCall.mock.calls[1]?.[1]).toBe(createCall.mock.calls[0]?.[1]);
  });

  it('goes back on cancel', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('is closed to a person who may not add contacts', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    await show();
    expect(await screen.findByText("You can't add contacts")).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
    sessionCall.mockResolvedValue(sessionNoContacts);
  });

  describe('the properties the workspace requires', () => {
    const stamp = '2026-09-01T08:00:00.000Z';
    const sessionProps = {
      ...sessionFull,
      permissions: { ...sessionFull.permissions, 'record.contact-properties.read': 'all' },
    } as typeof sessionFull;

    const firstName = field({
      key: 'first_name',
      label: 'First Name',
      fieldType: 'text',
      isRequired: true,
    });
    const countryBase = field({
      key: 'country_region',
      label: 'Country Region',
      fieldType: 'select',
      isRequired: true,
    });
    const country = {
      ...countryBase,
      options: [
        option(countryBase.id, 'in', 'India', 1),
        option(countryBase.id, 'us', 'United States', 2),
      ],
    };
    const stateBase = field({
      key: 'state_region',
      label: 'State Region',
      fieldType: 'select',
      isRequired: true,
    });
    const state = { ...stateBase, options: [option(stateBase.id, 'mh', 'Maharashtra', 1)] };
    const stateOnIndia = {
      id: '99999999-0000-4000-8000-000000000001',
      fieldId: state.id,
      dependsOnFieldId: country.id,
      dependsOnOptionId: country.options[0]!.id,
      dependsOnValue: null,
      createdAt: stamp,
    };
    // Things the API never asks a new contact for: they must not show up.
    const notAsked = [
      field({ key: 'nickname', label: 'Nickname', fieldType: 'text' }),
      field({
        key: 'street',
        label: 'Street',
        fieldType: 'text',
        isRequired: true,
        isHidden: true,
      }),
      field({
        key: 'owner_note',
        label: 'Owner note',
        fieldType: 'text',
        isRequired: true,
        isSystem: true,
      }),
      field({ key: 'agreed', label: 'Agreed', fieldType: 'boolean', isRequired: true }),
    ];

    const choose = async (label: string, option: string) => {
      await fireEvent.press(await screen.findByRole('button', { name: label }));
      await fireEvent.press(await screen.findByRole('radio', { name: option }));
    };

    beforeEach(() => {
      sessionCall.mockResolvedValue(sessionProps);
      fieldsCall.mockResolvedValue([firstName, country, state, ...notAsked]);
      dependenciesCall.mockResolvedValue([stateOnIndia]);
    });

    it('asks for them under the email, and sends them with the contact', async () => {
      createCall.mockResolvedValue(aarav);
      await show();
      await fireEvent.changeText(await screen.findByLabelText('First Name'), ' Aarav ');
      await choose('Country Region', 'United States');
      await fireEvent.changeText(screen.getByLabelText('Email'), 'aarav@example.test');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          {
            email: 'aarav@example.test',
            customFields: { first_name: 'Aarav', country_region: 'us' },
          },
          expect.any(String),
        ),
      );
      await waitFor(() => expect(router.replace).toHaveBeenCalled());
    });

    it('does not ask for what the API would not: optional, hidden, system or yes/no properties', async () => {
      await show();
      await screen.findByLabelText('First Name');
      for (const label of ['Nickname', 'Street', 'Owner note', 'Agreed']) {
        expect(screen.queryByLabelText(label)).toBeNull();
      }
    });

    it('stops before sending while a required property is empty, and says which', async () => {
      await show();
      await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
      await save();
      expect(await screen.findByText('First Name is required.')).toBeTruthy();
      expect(screen.getByText('Country Region is required.')).toBeTruthy();
      expect(createCall).not.toHaveBeenCalled();
    });

    it('shows a dependent property only once the one it depends on has the wanted value', async () => {
      createCall.mockResolvedValue(aarav);
      await show();
      await screen.findByLabelText('First Name');
      expect(screen.queryByRole('button', { name: 'State Region' })).toBeNull();
      await choose('Country Region', 'United States');
      expect(screen.queryByRole('button', { name: 'State Region' })).toBeNull();
      await choose('Country Region', 'India');
      await choose('State Region', 'Maharashtra');
      await fireEvent.changeText(screen.getByLabelText('First Name'), 'Aarav');
      await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.co');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          {
            email: 'a@b.co',
            customFields: { first_name: 'Aarav', country_region: 'in', state_region: 'mh' },
          },
          expect.any(String),
        ),
      );
    });

    it('searches a long list of options', async () => {
      const many = {
        ...countryBase,
        options: Array.from({ length: 20 }, (_, i) =>
          option(countryBase.id, `c${i}`, i === 7 ? 'Zambia' : `Country ${i}`, i + 1),
        ),
      };
      fieldsCall.mockResolvedValue([many]);
      dependenciesCall.mockResolvedValue([]);
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Country Region' }));
      await fireEvent.changeText(await screen.findByLabelText('Search'), 'zamb');
      expect(screen.getByRole('radio', { name: 'Zambia' })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: 'Country 3' })).toBeNull();
    });

    it('says so when a required property is one the app cannot fill in', async () => {
      fieldsCall.mockResolvedValue([
        field({ key: 'account', label: 'Account', fieldType: 'lookup', isRequired: true }),
      ]);
      await show();
      await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
      expect(
        await screen.findByText(
          "Account is required, but it can't be filled in here yet. Add this contact on the web.",
        ),
      ).toBeTruthy();
      await save();
      expect(createCall).not.toHaveBeenCalled();
    });

    it('lets the API name what is missing when the definitions could not be read, and then asks for it', async () => {
      dependenciesCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      createCall.mockRejectedValueOnce(
        new ApiError(422, 'CON_REQUIRED_PROPERTY_MISSING', 'missing', undefined, [
          { path: 'customFields.first_name', message: 'required' },
        ]),
      );
      createCall.mockResolvedValueOnce(aarav);
      await show();
      await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
      await save();
      expect(await screen.findByText('First Name is required.')).toBeTruthy();
      expect(screen.queryByText(/needs more details/)).toBeNull();
      await fireEvent.changeText(screen.getByLabelText('First Name'), 'Aarav');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenLastCalledWith(
          { email: 'a@b.co', customFields: { first_name: 'Aarav' } },
          expect.any(String),
        ),
      );
    });

    it('explains itself when the API wants properties the person is not allowed to see', async () => {
      sessionCall.mockResolvedValue(sessionFull);
      createCall.mockRejectedValue(
        new ApiError(422, 'CON_REQUIRED_PROPERTY_MISSING', 'missing', undefined, [
          { path: 'customFields.first_name', message: 'required' },
        ]),
      );
      await show();
      await fireEvent.changeText(await screen.findByLabelText('Email'), 'a@b.co');
      await save();
      expect(
        await screen.findByText(/needs more details before a contact can be saved/),
      ).toBeTruthy();
      expect(fieldsCall).not.toHaveBeenCalled();
    });
  });
});
