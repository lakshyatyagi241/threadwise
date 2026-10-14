import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  assignees,
  bare,
  fieldDefinitions,
  field,
  gstField,
  option,
  profile,
  rohan,
  sessionProps,
  sessionPropsReadOnly,
  statusOptions,
} from '@/test/contact-properties-fixtures';
import { sessionFull } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { AboutTab } from './about-tab';
import * as propertiesApi from './properties-api';
import { useContact } from './use-contacts';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getContact);
const updateCall = jest.mocked(api.updateContact);
const fieldsCall = jest.mocked(propertiesApi.listContactFields);
const optionsCall = jest.mocked(propertiesApi.listFieldOptions);
const assigneesCall = jest.mocked(propertiesApi.listAssignees);
const statusCall = jest.mocked(propertiesApi.listContactStatusOptions);
const ownerCall = jest.mocked(propertiesApi.setContactAssignee);
const sectionsCall = jest.mocked(propertiesApi.listFieldSections);

/** The parent screen in miniature: it reads the contact and hands it to the tab, so a saved change comes back through the cache. */
function Page() {
  const contact = useContact(profile.id);
  return contact.data ? <AboutTab tags={[]} contact={contact.data} /> : null;
}

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<Page />);
  client = view.queryClient;
  return view;
}

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  // Only the fakes of this file: resetAllMocks would also empty the mocks React Native's own jest setup builds its native
  // components from, and the switch would render as nothing.
  for (const fake of [
    sessionCall,
    getCall,
    updateCall,
    fieldsCall,
    optionsCall,
    assigneesCall,
    statusCall,
    ownerCall,
    sectionsCall,
  ]) {
    fake.mockReset();
  }
  client = undefined;
  sessionCall.mockResolvedValue(sessionProps);
  getCall.mockResolvedValue(profile);
  fieldsCall.mockResolvedValue(fieldDefinitions);
  assigneesCall.mockResolvedValue(assignees);
  statusCall.mockResolvedValue(statusOptions);
  sectionsCall.mockResolvedValue([]);
});
afterEach(async () => {
  if (client) await settled(client);
});

/** A row of the card, by its label and what it shows. */
const row = (label: string, value: string) =>
  screen.findByRole('button', { name: `${label}: ${value}` });

describe('AboutTab rows', () => {
  it('shows the fixed rows, then the properties, as label and value', async () => {
    await show();
    expect(await row('Email', 'aarav@example.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phone: +919812345678' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contact owner: Priya Nair' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Name: Aarav Sharma' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Source: import' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'WhatsApp subscription: Subscribed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marketing opt-out: No' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lead score: 40' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'City: Pune' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'VIP customer: Yes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan: Pro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Interests: Sports, Travel' })).toBeTruthy();
    // A masked value shows dots, and is spoken as hidden.
    expect(screen.getByRole('button', { name: 'Secret: Hidden' })).toBeTruthy();
    expect(screen.getByText('••••••')).toBeTruthy();
    expect(
      screen.getByText('You can customize the properties you see here from your web app.'),
    ).toBeTruthy();
    expect(fieldsCall).toHaveBeenCalledTimes(1);
  });

  it('leaves out properties that are hidden or switched off', async () => {
    await show();
    await screen.findByRole('button', { name: 'City: Pune' });
    expect(screen.queryByText('Internal')).toBeNull();
    expect(screen.queryByText('Retired')).toBeNull();
  });

  it('hides the empty rows until "Show empty fields" is on, then shows them as --', async () => {
    getCall.mockResolvedValue(bare);
    await show();
    await row('Email', 'aarav@example.test');
    await settled(client!);
    expect(screen.queryByText('Contact owner')).toBeNull();
    expect(screen.queryByText('Lead score')).toBeNull();
    expect(screen.queryByText('City')).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Show empty fields' });
    expect(toggle.props.value).toBe(false);
    await fireEvent(toggle, 'valueChange', true);
    expect(screen.getByRole('button', { name: 'Contact owner: --' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lead score: --' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'City: --' })).toBeTruthy();
    await fireEvent(
      screen.getByRole('switch', { name: 'Show empty fields' }),
      'valueChange',
      false,
    );
    expect(screen.queryByText('City')).toBeNull();
  });

  it('folds the card away and back', async () => {
    await show();
    await row('Email', 'aarav@example.test');
    const header = screen.getByRole('button', { name: 'Contact information' });
    expect(header.props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(header);
    expect(screen.queryByRole('switch', { name: 'Show empty fields' })).toBeNull();
    expect(screen.queryByText('Email')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Contact information' }));
    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('says a row cannot be edited when it is read only, a formula, computed, or a system property', async () => {
    await show();
    await fireEvent.press(await row('Tax ID', 'TX-1'));
    expect(await screen.findByText("You can't edit Tax ID")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Total: 42' }));
    expect(screen.getByText("You can't edit Total")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'System note: managed' }));
    expect(screen.getByText("You can't edit System note")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Created: / }));
    expect(screen.getByText("You can't edit Created")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Secret: / }));
    expect(screen.getByText("You can't edit Secret")).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('takes the notice away after a few seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      await show();
      await fireEvent.press(await row('Tax ID', 'TX-1'));
      expect(await screen.findByText("You can't edit Tax ID")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.queryByText("You can't edit Tax ID")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('points a property that needs a record picker to the web app', async () => {
    await show();
    await fireEvent.press(await row('Account', 'acc-1'));
    expect(await screen.findByText('Account can only be edited from the web app.')).toBeTruthy();
  });

  it('shows the values and offers no editing to a person who may only read', async () => {
    sessionCall.mockResolvedValue(sessionPropsReadOnly);
    await show();
    expect(await screen.findByText('aarav@example.test')).toBeTruthy();
    expect(await screen.findByText('Pune')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Email: / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^City: / })).toBeNull();
  });

  it('shows the values under their keys when the person may not read the property list', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    await show();
    expect(await screen.findByRole('button', { name: 'city: Pune' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'vip: Yes' })).toBeTruthy();
    expect(fieldsCall).not.toHaveBeenCalled();
    expect(statusCall).not.toHaveBeenCalled();
  });

  it('falls back to the values under their keys when the API refuses the property list', async () => {
    fieldsCall.mockRejectedValue(new ApiError(403, 'RBAC_FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByRole('button', { name: 'city: Pune' })).toBeTruthy();
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  it('says so, with a way to try again, when the property list fails to load', async () => {
    fieldsCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'city: Pune' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'City: Pune' })).toBeTruthy();
    expect(
      screen.queryByText("Can't reach the server. Check your connection and try again."),
    ).toBeNull();
  });

  it('shows a dash for an owner it cannot name', async () => {
    assigneesCall.mockResolvedValue([rohan]);
    await show();
    expect(await row('Contact owner', '--')).toBeTruthy();
  });
});

describe('AboutTab sections and search', () => {
  const section = {
    id: 'cccccccc-0000-4000-8000-000000000001',
    moduleKey: 'contacts' as const,
    name: 'Location',
    position: 1,
    isActive: true,
    rowVersion: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  };

  it('puts a property under the name of the section the workspace gave it', async () => {
    sectionsCall.mockResolvedValue([section]);
    fieldsCall.mockResolvedValue(
      fieldDefinitions.map((f) => (f.key === 'city' ? { ...f, sectionId: section.id } : f)),
    );
    await show();
    expect(await screen.findByRole('header', { name: 'Location' })).toBeTruthy();
    expect(screen.getByText('Pune')).toBeTruthy();
  });

  it('keeps showing the values when the sections cannot be read', async () => {
    sectionsCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText('Pune')).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Location' })).toBeNull();
  });

  it('narrows the rows to what was typed, by name or by value', async () => {
    await show();
    await screen.findByText('Pune');
    await fireEvent.changeText(screen.getByLabelText('Search fields'), 'pun');
    expect(screen.getByText('Pune')).toBeTruthy();
    expect(screen.queryByText('Email')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search fields'), '');
    expect(await screen.findByText('Email')).toBeTruthy();
  });
});

describe('AboutTab standard fields', () => {
  it('edits the email and saves it with the row version that was read', async () => {
    updateCall.mockResolvedValue({ ...profile, email: 'new@example.test', rowVersion: 4 });
    await show();
    await fireEvent.press(await row('Email', 'aarav@example.test'));
    expect(screen.getByRole('header', { name: 'Edit Email' })).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('aarav@example.test');
    expect(screen.getByLabelText('Email').props.keyboardType).toBe('email-address');
    await fireEvent.changeText(screen.getByLabelText('Email'), ' new@example.test ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { email: 'new@example.test', rowVersion: 3 },
        expect.any(String),
      ),
    );
    // The sheet closes and the card behind shows the saved contact.
    expect(await row('Email', 'new@example.test')).toBeTruthy();
    expect(screen.queryByRole('header', { name: /^Edit / })).toBeNull();
  });

  it('refuses a bad email without asking the server', async () => {
    await show();
    await fireEvent.press(await row('Email', 'aarav@example.test'));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'ok@example.test');
    expect(screen.queryByText('Enter a valid email address.')).toBeNull();
  });

  it('sends the phone as digits with the country code', async () => {
    updateCall.mockResolvedValue({ ...profile, phone: '+919876543210', rowVersion: 4 });
    await show();
    await fireEvent.press(await row('Phone', '+919812345678'));
    expect(screen.getByLabelText('Phone').props.keyboardType).toBe('phone-pad');
    await fireEvent.changeText(screen.getByLabelText('Phone'), '+91 98765-43210');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { phone: '+919876543210', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('refuses a phone without a country code', async () => {
    await show();
    await fireEvent.press(await row('Phone', '+919812345678'));
    await fireEvent.changeText(screen.getByLabelText('Phone'), '12345');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Enter the phone number with the country code, for example +919876543210.',
      ),
    ).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('will not empty the only way to reach a contact', async () => {
    getCall.mockResolvedValue({ ...profile, phone: null });
    await show();
    await fireEvent.press(await row('Email', 'aarav@example.test'));
    await fireEvent.changeText(screen.getByLabelText('Email'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('A contact needs a phone number or an email address.'),
    ).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('sends an emptied name as null, and closes without a request when nothing changed', async () => {
    updateCall.mockResolvedValue({ ...profile, name: null, firstName: null, lastName: null });
    await show();
    await fireEvent.press(await row('Name', 'Aarav Sharma'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(updateCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: /^Edit / })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Name: Aarav Sharma' }));
    await fireEvent.changeText(screen.getByLabelText('Name'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { name: null, rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('closes on back and on the dimmed page, without saving', async () => {
    await show();
    await fireEvent.press(await row('Name', 'Aarav Sharma'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Someone else');
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('header', { name: /^Edit / })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Name: Aarav Sharma' }));
    // The dimmed page is not offered to screen readers while the sheet is open (Back is), so it is found as hidden.
    await fireEvent.press(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(screen.queryByRole('header', { name: /^Edit / })).toBeNull();
    expect(updateCall).not.toHaveBeenCalled();
  });
});

describe('AboutTab custom properties', () => {
  const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  const sent = (customFields: Record<string, unknown>) =>
    expect(updateCall).toHaveBeenCalledWith(
      profile.id,
      { customFields, rowVersion: 3 },
      expect.any(String),
    );

  beforeEach(() => {
    updateCall.mockImplementation(async (_id, body) => ({
      ...profile,
      customFields: { ...profile.customFields, ...body.customFields },
      rowVersion: 4,
    }));
  });

  it('edits a text property', async () => {
    await show();
    await fireEvent.press(await row('City', 'Pune'));
    expect(screen.getByRole('header', { name: 'Edit City' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('City'), 'Mumbai');
    await save();
    await waitFor(() => sent({ city: 'Mumbai' }));
    expect(await row('City', 'Mumbai')).toBeTruthy();
  });

  it('clears a text property by sending null', async () => {
    await show();
    await fireEvent.press(await row('City', 'Pune'));
    await fireEvent.changeText(screen.getByLabelText('City'), '   ');
    await save();
    await waitFor(() => sent({ city: null }));
  });

  it('edits a long text with a multi-line field', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Notes: / }));
    expect(screen.getByLabelText('Notes').props.multiline).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Call on Monday');
    await save();
    await waitFor(() => sent({ notes: 'Call on Monday' }));
  });

  it('edits a number, with a number keyboard, and refuses text', async () => {
    await show();
    await fireEvent.press(await row('Visits', '3'));
    expect(screen.getByLabelText('Visits').props.keyboardType).toBe('number-pad');
    await fireEvent.changeText(screen.getByLabelText('Visits'), 'many');
    await save();
    expect(await screen.findByText('Enter a number.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Visits'), '2.5');
    await save();
    expect(await screen.findByText('Enter a whole number.')).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Visits'), '7');
    await save();
    await waitFor(() => sent({ visits: 7 }));
  });

  it('edits an amount and a percentage as numbers, with a decimal keyboard', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Budget: / }));
    expect(screen.getByLabelText('Budget').props.keyboardType).toBe('decimal-pad');
    await fireEvent.changeText(screen.getByLabelText('Budget'), '2500.75');
    await save();
    await waitFor(() => sent({ budget: 2500.75 }));
  });

  it('edits a link and refuses one without http', async () => {
    await show();
    await fireEvent.press(await row('Website', 'https://example.test'));
    expect(screen.getByLabelText('Website').props.keyboardType).toBe('url');
    await fireEvent.changeText(screen.getByLabelText('Website'), 'example.test');
    await save();
    expect(
      await screen.findByText('Enter a link that starts with http:// or https://'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Website'), 'https://new.example.test');
    await save();
    await waitFor(() => sent({ website: 'https://new.example.test' }));
  });

  it('holds a required property to a value', async () => {
    fieldsCall.mockResolvedValue([gstField]);
    getCall.mockResolvedValue({ ...profile, customFields: { gst_no: '27ABCDE1234F1Z5' } });
    await show();
    await fireEvent.press(await row('GST number', '27ABCDE1234F1Z5'));
    await fireEvent.changeText(screen.getByLabelText('GST number'), '');
    await save();
    expect(await screen.findByText('GST number is required.')).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('switches a checkbox property', async () => {
    await show();
    await fireEvent.press(await row('VIP customer', 'Yes'));
    const toggle = screen.getByRole('switch', { name: 'VIP customer' });
    expect(toggle.props.value).toBe(true);
    await fireEvent(toggle, 'valueChange', false);
    await save();
    await waitFor(() => sent({ vip: false }));
    expect(await row('VIP customer', 'No')).toBeTruthy();
  });

  it('edits a date as year-month-day and refuses a day that does not exist', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Birthday: / }));
    expect(screen.getByLabelText('Birthday').props.value).toBe('2026-10-12');
    await fireEvent.changeText(screen.getByLabelText('Birthday'), '2026-02-30');
    await save();
    expect(await screen.findByText('Enter a valid date as YYYY-MM-DD.')).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Birthday'), '2026-12-25');
    await save();
    await waitFor(() => sent({ birthday: '2026-12-25' }));
  });

  it('clears a date with the clear button', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Birthday: / }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Birthday').props.value).toBe('');
    await save();
    await waitFor(() => sent({ birthday: null }));
  });

  it('edits a date and time as two inputs and joins them', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Next visit: / }));
    expect(screen.getByLabelText('Date').props.value).toBe('2026-11-03');
    expect(screen.getByLabelText('Time').props.value).toBe('14:30');
    await fireEvent.changeText(screen.getByLabelText('Time'), '25:00');
    await save();
    expect(await screen.findByText('Enter a valid time as HH:mm.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Time'), '09:15');
    await fireEvent.changeText(screen.getByLabelText('Date'), '2026-11-04');
    await save();
    await waitFor(() => sent({ next_visit: '2026-11-04T09:15' }));
  });

  it('picks one option from a list, leaves out hidden options, and clears', async () => {
    await show();
    await fireEvent.press(await row('Plan', 'Pro'));
    expect(screen.getByRole('radio', { name: 'Pro' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.queryByRole('radio', { name: 'Legacy plan' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Basic' }));
    expect(screen.getByRole('radio', { name: 'Basic' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    await save();
    await waitFor(() => sent({ plan: 'basic' }));
    await fireEvent.press(await row('Plan', 'Basic'));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenLastCalledWith(
        profile.id,
        { customFields: { plan: null }, rowVersion: 4 },
        expect.any(String),
      ),
    );
  });

  it('ticks several options from a list', async () => {
    await show();
    await fireEvent.press(await row('Interests', 'Sports, Travel'));
    expect(screen.getByRole('checkbox', { name: 'Sports' }).props.accessibilityState).toMatchObject(
      {
        checked: true,
      },
    );
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Music' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Sports' }));
    await save();
    await waitFor(() => sent({ interests: ['travel', 'music'] }));
  });

  it('reads the options from the API when the definition did not carry them', async () => {
    const bare = field({ key: 'tier', label: 'Tier', fieldType: 'select' });
    fieldsCall.mockResolvedValue([bare]);
    getCall.mockResolvedValue({ ...profile, customFields: { tier: 'gold' } });
    optionsCall.mockResolvedValue([
      option(bare.id, 'gold', 'Gold', 1),
      option(bare.id, 'silver', 'Silver', 2),
    ]);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Tier: / }));
    expect(await screen.findByRole('radio', { name: 'Silver' })).toBeTruthy();
    expect(optionsCall).toHaveBeenCalledWith(bare.id, expect.anything());
    await fireEvent.press(screen.getByRole('radio', { name: 'Silver' }));
    await save();
    await waitFor(() => sent({ tier: 'silver' }));
  });

  it('says so, with a way to try again, when the options cannot be read', async () => {
    const tier = field({ key: 'tier', label: 'Tier', fieldType: 'select' });
    fieldsCall.mockResolvedValue([tier]);
    getCall.mockResolvedValue({ ...profile, customFields: { tier: 'gold' } });
    optionsCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    optionsCall.mockResolvedValue([option(tier.id, 'gold', 'Gold', 1)]);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Tier: / }));
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Gold' })).toBeTruthy();
  });

  it('says so when a list has nothing to choose from', async () => {
    const empty = field({ key: 'tier', label: 'Tier', fieldType: 'select', options: [] });
    fieldsCall.mockResolvedValue([empty]);
    getCall.mockResolvedValue({ ...profile, customFields: { tier: 'gold' } });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Tier: / }));
    expect(screen.getByText('There are no options to choose from.')).toBeTruthy();
  });

  it('closes without a request when the value did not change', async () => {
    await show();
    await fireEvent.press(await row('City', 'Pune'));
    await save();
    expect(updateCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: /^Edit / })).toBeNull();
  });

  it('keeps the other properties out of the request', async () => {
    await show();
    await fireEvent.press(await row('City', 'Pune'));
    await fireEvent.changeText(screen.getByLabelText('City'), 'Goa');
    await save();
    await waitFor(() => expect(updateCall).toHaveBeenCalledTimes(1));
    expect(Object.keys(updateCall.mock.calls[0]![1].customFields ?? {})).toEqual(['city']);
  });
});

describe('AboutTab save failures', () => {
  const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  async function editCity() {
    await show();
    await fireEvent.press(await row('City', 'Pune'));
    await fireEvent.changeText(screen.getByLabelText('City'), 'Goa');
    await save();
  }

  it('reads the contact again and asks for another look when someone else saved first', async () => {
    updateCall.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
    getCall.mockResolvedValueOnce(profile).mockResolvedValue({
      ...profile,
      customFields: { ...profile.customFields, city: 'Delhi' },
      rowVersion: 4,
    });
    await editCity();
    expect(
      await screen.findByText('This contact was changed by someone else. Review and save again.'),
    ).toBeTruthy();
    await waitFor(() => expect(getCall).toHaveBeenCalledTimes(2));
    // Saving again carries the version that was read last.
    updateCall.mockResolvedValue({
      ...profile,
      customFields: { ...profile.customFields, city: 'Goa' },
      rowVersion: 5,
    });
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenLastCalledWith(
        profile.id,
        { customFields: { city: 'Goa' }, rowVersion: 4 },
        expect.any(String),
      ),
    );
    expect(await row('City', 'Goa')).toBeTruthy();
  });

  it('says a property can no longer be edited', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'CON_PROPERTY_NOT_EDITABLE', 'no'));
    await editCity();
    expect(await screen.findByText("This property can't be edited.")).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Edit City' })).toBeTruthy();
  });

  it('says when a required property has no value', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'CON_REQUIRED_PROPERTY_MISSING', 'no'));
    await editCity();
    expect(
      await screen.findByText('A required property has no value. Fill it in before saving.'),
    ).toBeTruthy();
  });

  it("shows what the server refused under the field, in the app's own words", async () => {
    updateCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid value for: city.', undefined, [
        { path: 'customFields.city', message: 'must be text' },
      ]),
    );
    await editCity();
    expect(
      await screen.findByText("That value isn't accepted. Check it and try again."),
    ).toBeTruthy();
    expect(screen.queryByText('must be text')).toBeNull();
  });

  it('says when the server cannot be reached, and lets the person try again', async () => {
    updateCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await editCity();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    updateCall.mockResolvedValue({
      ...profile,
      customFields: { ...profile.customFields, city: 'Goa' },
      rowVersion: 4,
    });
    await save();
    await waitFor(() => expect(updateCall).toHaveBeenCalledTimes(2));
    // A lost connection keeps the idempotency key, so the repeat is the same request.
    expect(updateCall.mock.calls[1]![2]).toBe(updateCall.mock.calls[0]![2]);
  });
});

describe('AboutTab contact owner', () => {
  const owner = () => screen.getByRole('header', { name: 'Assign to' });

  it('lists the people, with the current owner ticked and an Unassigned choice', async () => {
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    expect(owner()).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Priya Nair' }).props.accessibilityState,
    ).toMatchObject({
      checked: true,
    });
    expect(screen.getByRole('radio', { name: 'Rohan Das' }).props.accessibilityState).toMatchObject(
      {
        checked: false,
      },
    );
    expect(
      screen.getByRole('radio', { name: 'Unassigned' }).props.accessibilityState,
    ).toMatchObject({
      checked: false,
    });
    expect(screen.getByText('rohan@example.test')).toBeTruthy();
  });

  it('hands the contact over with the bulk owner call, which needs no row version, and shows the new name', async () => {
    ownerCall.mockResolvedValue({ succeeded: [profile.id], failed: [] });
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Rohan Das' }));
    getCall.mockResolvedValue({ ...profile, ownerId: rohan.id, rowVersion: 4 });
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(ownerCall).toHaveBeenCalledWith(
        { ids: [profile.id], ownerId: rohan.id },
        expect.any(String),
      ),
    );
    // The contact is read again for its new version, and the sheet closes on it.
    expect(await row('Contact owner', 'Rohan Das')).toBeTruthy();
    expect(getCall).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('header', { name: 'Assign to' })).toBeNull();
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('takes the owner away with Unassigned', async () => {
    ownerCall.mockResolvedValue({ succeeded: [profile.id], failed: [] });
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Unassigned' }));
    getCall.mockResolvedValue({ ...profile, ownerId: null, rowVersion: 4 });
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(ownerCall).toHaveBeenCalledWith(
        { ids: [profile.id], ownerId: null },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Contact owner: / })).toBeNull(),
    );
  });

  it('closes without a request when the owner is the same', async () => {
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(ownerCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: 'Assign to' })).toBeNull();
  });

  it('treats a contact in "failed" as an error, not a save', async () => {
    ownerCall.mockResolvedValue({
      succeeded: [],
      failed: [{ id: profile.id, code: 'FORBIDDEN', message: 'no' }],
    });
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Rohan Das' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't change the owner. Try again.")).toBeTruthy();
    expect(owner()).toBeTruthy();
    // Nothing changed, so the contact is not read again.
    expect(getCall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: 'Rohan Das' }).props.accessibilityState).toMatchObject(
      {
        checked: true,
      },
    );
  });

  it('shows the error of a call the API refused', async () => {
    ownerCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    await fireEvent.press(await row('Contact owner', 'Priya Nair'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Rohan Das' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('keeps Save off until the people are loaded, and offers a retry when they fail', async () => {
    assigneesCall.mockRejectedValue(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    await fireEvent.press(await row('Contact owner', '--'));
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    assigneesCall.mockResolvedValue(assignees);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Priya Nair' })).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Priya Nair' }).props.accessibilityState,
    ).toMatchObject({
      checked: true,
    });
  });

  it('says when there is nobody to hand the contact to', async () => {
    assigneesCall.mockResolvedValue([]);
    getCall.mockResolvedValue({ ...profile, ownerId: null });
    await show();
    await screen.findByRole('button', { name: 'Email: aarav@example.test' });
    await fireEvent(screen.getByRole('switch', { name: 'Show empty fields' }), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Contact owner: --' }));
    expect(await screen.findByText('There is no one to assign this contact to.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Unassigned' })).toBeTruthy();
  });
});

describe('AboutTab cache', () => {
  it('replaces the contact in the cache with the saved one and refreshes the lists', async () => {
    updateCall.mockResolvedValue({
      ...profile,
      customFields: { ...profile.customFields, city: 'Goa' },
      rowVersion: 4,
    });
    const view = await show();
    const refresh = jest.spyOn(view.queryClient, 'invalidateQueries');
    await fireEvent.press(await row('City', 'Pune'));
    await fireEvent.changeText(screen.getByLabelText('City'), 'Goa');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateCall).toHaveBeenCalled());
    await waitFor(() =>
      expect(view.queryClient.getQueryData(['contacts', 'detail', profile.id])).toMatchObject({
        rowVersion: 4,
      }),
    );
    expect(refresh).toHaveBeenCalledWith({ queryKey: ['contacts', 'list'] });
  });
});
