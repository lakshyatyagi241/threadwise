import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  profile,
  sessionProps,
  sessionPropsReadOnly,
  statusOptions,
} from '@/test/contact-properties-fixtures';
import { sessionFull } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { LifecycleCard } from './lifecycle-card';
import * as propertiesApi from './properties-api';
import { useContact } from './use-contacts';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getContact);
const updateCall = jest.mocked(api.updateContact);
const statusCall = jest.mocked(propertiesApi.listContactStatusOptions);

/** The parent screen in miniature: it reads the contact and hands it to the card. */
function Page() {
  const contact = useContact(profile.id);
  return contact.data ? <LifecycleCard contact={contact.data} /> : null;
}

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<Page />);
  client = view.queryClient;
  return view;
}

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

/** The dropdowns appear once the session and the options have been read; both open the same sheet. */
const SHEET = 'Edit lifecycle stage/status';
const openSheet = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: /^Lifecycle stage: / }));
  return screen.findByRole('header', { name: SHEET });
};
const openSheetFromStatus = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: /^Status: / }));
  return screen.findByRole('header', { name: SHEET });
};
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const save = () => fireEvent.press(saveButton());
const saveOff = () => saveButton().props.accessibilityState.disabled as boolean;
/** What a dropdown of the sheet shows now. */
const shown = (field: string) =>
  screen.getByRole('button', { name: field }).props.accessibilityValue.text as string;
/** Opens a dropdown of the sheet and picks one of its options. */
const pick = async (field: string, option: string) => {
  await fireEvent.press(screen.getByRole('button', { name: field }));
  await fireEvent.press(screen.getByRole('radio', { name: option }));
};
const options = (field: string) =>
  fireEvent
    .press(screen.getByRole('button', { name: field }))
    .then(() => screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel as string));

beforeEach(() => {
  for (const fake of [sessionCall, getCall, updateCall, statusCall]) fake.mockReset();
  client = undefined;
  sessionCall.mockResolvedValue(sessionProps);
  getCall.mockResolvedValue(profile);
  statusCall.mockResolvedValue(statusOptions);
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('LifecycleCard', () => {
  it('shows the stage and the status by the names the workspace gave them', async () => {
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Lifecycle stage')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(statusCall).toHaveBeenCalledTimes(1);
  });

  it('shows -- for a contact without a stage, a status or a score', async () => {
    getCall.mockResolvedValue({ ...profile, lifecycleStage: null, status: null, leadScore: null });
    await show();
    expect(await screen.findAllByText('--')).toHaveLength(3);
  });

  it('shows the lead score beside the stage and the status', async () => {
    getCall.mockResolvedValue({ ...profile, leadScore: 82 });
    await show();
    expect(await screen.findByText('82')).toBeTruthy();
    expect(screen.getByText('Score')).toBeTruthy();
  });

  it('shows the values and no pencil to a person who may only read', async () => {
    sessionCall.mockResolvedValue(sessionPropsReadOnly);
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    await settled(client!);
    expect(screen.queryByRole('button', { name: /^(Lifecycle stage|Status): / })).toBeNull();
  });

  it('shows the current values and asks for nothing when the person may not read the options', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    await settled(client!);
    expect(statusCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^(Lifecycle stage|Status): / })).toBeNull();
  });

  it('falls back to the current values, without a pencil, when the API refuses the options', async () => {
    statusCall.mockRejectedValue(new ApiError(403, 'RBAC_FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    await settled(client!);
    expect(screen.queryByRole('button', { name: /^(Lifecycle stage|Status): / })).toBeNull();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('offers the built-in stages and statuses when the workspace has set up none, as the web does', async () => {
    statusCall.mockResolvedValue([]);
    getCall.mockResolvedValue({ ...profile, lifecycleStage: 'new', status: 'prospect' });
    await show();
    // The name of a built-in status and stage, and a caret to open them.
    expect(await screen.findByText('Prospect')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Lifecycle stage: New/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Status: / }));
    expect(await options('Lifecycle stage')).toEqual([
      'New',
      'Contacted',
      'Qualified',
      'Application started',
      'Application submitted',
      'Interview scheduled',
      'Offer received',
      'Admission confirmed',
      'Enrolled',
      'Lost',
    ]);
    await fireEvent.press(screen.getByRole('radio', { name: 'New' }));
    expect(await options('Lifecycle stage status')).toEqual([
      'Active',
      'Prospect',
      'Customer',
      'VIP',
    ]);
  });

  it('names an unknown stage in words', async () => {
    statusCall.mockResolvedValue([]);
    getCall.mockResolvedValue({ ...profile, lifecycleStage: 'on_hold', status: 'Waiting' });
    await show();
    expect(await screen.findByText('On Hold')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
  });
});

describe('LifecycleCard sheet', () => {
  it('is one sheet with the stage and its status as required dropdowns, whichever cell opened it', async () => {
    await show();
    await openSheetFromStatus();
    expect(shown('Lifecycle stage')).toBe('Qualified');
    expect(shown('Lifecycle stage status')).toBe('Open');
    expect(screen.queryByRole('button', { name: 'Lost reason' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await openSheet();
    expect(shown('Lifecycle stage')).toBe('Qualified');
  });

  it('shows a stage the workspace does not list, such as the platform default, instead of "Select…"', async () => {
    getCall.mockResolvedValue({ ...profile, lifecycleStage: 'on_hold', status: null });
    await show();
    await openSheet();
    expect(shown('Lifecycle stage')).toBe('On Hold');
    expect(await options('Lifecycle stage')).toEqual([
      'On Hold',
      'New lead',
      'Qualified',
      'Lost',
      'Enrolled',
    ]);
  });

  it('offers the four built-in statuses when the workspace has none, and asks for one', async () => {
    statusCall.mockResolvedValue(statusOptions.filter((o) => o.optionGroup !== 'status'));
    getCall.mockResolvedValue({ ...profile, status: null });
    updateCall.mockResolvedValue({ ...profile, status: 'vip', rowVersion: 4 });
    await show();
    await openSheet();
    const status = screen.getByRole('button', { name: 'Lifecycle stage status' });
    expect(status.props.accessibilityState.disabled).toBe(false);
    expect(saveOff()).toBe(true);
    await pick('Lifecycle stage status', 'VIP');
    expect(saveOff()).toBe(false);
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { status: 'vip', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('lists every stage, and only the statuses of the stage', async () => {
    await show();
    await openSheet();
    expect(await options('Lifecycle stage')).toEqual(['New lead', 'Qualified', 'Lost', 'Enrolled']);
    await fireEvent.press(screen.getByRole('radio', { name: 'Qualified' }));
    // Open is valid in every stage, Hot lead only here; Closed belongs to the lost stage and Retired is off.
    expect(await options('Lifecycle stage status')).toEqual(['Open', 'Hot lead']);
  });

  it('changes the stage and sends only that, with the row version that was read', async () => {
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'enrolled', rowVersion: 4 });
    await show();
    await openSheet();
    await pick('Lifecycle stage', 'Enrolled');
    expect(shown('Lifecycle stage')).toBe('Enrolled');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { lifecycleStage: 'enrolled', rowVersion: 3 },
        expect.any(String),
      ),
    );
    // The sheet closes and the card shows the saved stage.
    expect(await screen.findByText('Enrolled')).toBeTruthy();
    expect(screen.queryByRole('header', { name: SHEET })).toBeNull();
  });

  it('changes the status on its own', async () => {
    updateCall.mockResolvedValue({ ...profile, status: 'Hot', rowVersion: 4 });
    await show();
    await openSheetFromStatus();
    await pick('Lifecycle stage status', 'Hot lead');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { status: 'Hot', rowVersion: 3 },
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Hot lead')).toBeTruthy();
  });

  it('starts the status over when the stage changes, as the Geta app does, and sends both', async () => {
    getCall.mockResolvedValue({ ...profile, status: 'Hot' });
    updateCall.mockResolvedValue({
      ...profile,
      lifecycleStage: 'new',
      status: 'Open',
      rowVersion: 4,
    });
    await show();
    await openSheet();
    expect(shown('Lifecycle stage status')).toBe('Hot lead');
    await pick('Lifecycle stage', 'New lead');
    // Hot lead is not a status of the new stage; the first one that is takes its place.
    expect(shown('Lifecycle stage status')).toBe('Open');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { lifecycleStage: 'new', status: 'Open', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('closes without a request when nothing changed', async () => {
    await show();
    await openSheet();
    await save();
    expect(updateCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: SHEET })).toBeNull();
  });

  it('closes on back without saving', async () => {
    await show();
    await openSheet();
    await pick('Lifecycle stage', 'Enrolled');
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('header', { name: SHEET })).toBeNull();
    expect(updateCall).not.toHaveBeenCalled();
    // Opened again, it starts from the contact, not from the abandoned choice.
    await openSheet();
    expect(shown('Lifecycle stage')).toBe('Qualified');
  });
});

describe('LifecycleCard lost stage', () => {
  it('keeps Save off until the reason is given, then sends it', async () => {
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', rowVersion: 4 });
    await show();
    await openSheet();
    expect(screen.queryByRole('button', { name: 'Lost reason' })).toBeNull();
    await pick('Lifecycle stage', 'Lost');
    expect(screen.getByRole('button', { name: 'Lost reason' })).toBeTruthy();
    expect(saveOff()).toBe(true);
    await save();
    expect(updateCall).not.toHaveBeenCalled();
    await pick('Lost reason', 'Too expensive');
    expect(saveOff()).toBe(false);
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        {
          lifecycleStage: 'lost',
          lostReason: 'too_expensive',
          otherLostReason: null,
          rowVersion: 3,
        },
        expect.any(String),
      ),
    );
  });

  it('takes the reason in words when "Other" is chosen', async () => {
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', rowVersion: 4 });
    await show();
    await openSheet();
    await pick('Lifecycle stage', 'Lost');
    expect(screen.queryByLabelText('Describe the reason')).toBeNull();
    await pick('Lost reason', 'Other');
    expect(saveOff()).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Describe the reason'), ' Moved abroad ');
    expect(saveOff()).toBe(false);
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        expect.objectContaining({
          lifecycleStage: 'lost',
          otherLostReason: 'Moved abroad',
          lostReason: null,
          rowVersion: 3,
        }),
        expect.any(String),
      ),
    );
  });

  it('asks for words alone when the workspace has no lost reasons', async () => {
    statusCall.mockResolvedValue(statusOptions.filter((o) => o.optionGroup !== 'lost_reason'));
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', rowVersion: 4 });
    await show();
    await openSheet();
    await pick('Lifecycle stage', 'Lost');
    expect(screen.queryByRole('button', { name: 'Lost reason' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Describe the reason'), 'No budget');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        expect.objectContaining({ lifecycleStage: 'lost', otherLostReason: 'No budget' }),
        expect.any(String),
      ),
    );
  });

  it('does not ask again for a contact that is already lost', async () => {
    getCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', status: 'Closed' });
    updateCall.mockResolvedValue({
      ...profile,
      lifecycleStage: 'lost',
      status: 'Open',
      rowVersion: 4,
    });
    await show();
    await openSheetFromStatus();
    expect(screen.queryByRole('button', { name: 'Lost reason' })).toBeNull();
    await pick('Lifecycle stage status', 'Open');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { status: 'Open', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });
});

describe('LifecycleCard save failures', () => {
  async function changeStage() {
    await show();
    await openSheet();
    await pick('Lifecycle stage', 'Enrolled');
    await save();
  }

  it('reads the contact again and asks for another look when someone else saved first', async () => {
    updateCall.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
    getCall
      .mockResolvedValueOnce(profile)
      .mockResolvedValue({ ...profile, status: 'Hot', rowVersion: 4 });
    await changeStage();
    expect(
      await screen.findByText('This contact was changed by someone else. Review and save again.'),
    ).toBeTruthy();
    await waitFor(() => expect(getCall).toHaveBeenCalledTimes(2));
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'enrolled', rowVersion: 5 });
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenLastCalledWith(
        profile.id,
        expect.objectContaining({ lifecycleStage: 'enrolled', rowVersion: 4 }),
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Enrolled')).toBeTruthy();
  });

  it('says a reason is required when the API asks for one', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'CON_LOST_REASON_REQUIRED', 'no'));
    await changeStage();
    expect(await screen.findByText('Say why this contact was lost.')).toBeTruthy();
    expect(screen.getByRole('header', { name: SHEET })).toBeTruthy();
  });

  it('says when a status does not belong to the stage', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'CON_STATUS_STAGE_MISMATCH', 'no'));
    await changeStage();
    expect(
      await screen.findByText("That status doesn't belong to this lifecycle stage."),
    ).toBeTruthy();
  });

  it('says so when the server cannot be reached', async () => {
    updateCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await changeStage();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
  });
});
