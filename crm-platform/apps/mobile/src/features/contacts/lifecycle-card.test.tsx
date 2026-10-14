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

/** The pencil appears once the session and the options have been read. */
const openSheet = async () => {
  await fireEvent.press(await screen.findByRole('button', { name: 'Change lifecycle stage' }));
  return screen.findByRole('header', { name: 'Change lifecycle stage' });
};
const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save' }));
const radio = (name: string) => screen.getByRole('radio', { name });
const checked = (name: string) => radio(name).props.accessibilityState.checked as boolean;

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
    expect(screen.queryByRole('button', { name: 'Change lifecycle stage' })).toBeNull();
  });

  it('shows the current values and asks for nothing when the person may not read the options', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    await settled(client!);
    expect(statusCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Change lifecycle stage' })).toBeNull();
  });

  it('falls back to the current values, without a pencil, when the API refuses the options', async () => {
    statusCall.mockRejectedValue(new ApiError(403, 'RBAC_FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    await settled(client!);
    expect(screen.queryByRole('button', { name: 'Change lifecycle stage' })).toBeNull();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('has no pencil when the workspace has no stages or statuses', async () => {
    statusCall.mockResolvedValue([]);
    await show();
    expect(await screen.findByText('Qualified')).toBeTruthy();
    await settled(client!);
    expect(screen.queryByRole('button', { name: 'Change lifecycle stage' })).toBeNull();
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
  it('opens with the current stage and status ticked, and only the statuses of that stage', async () => {
    await show();
    await openSheet();
    expect(checked('Qualified')).toBe(true);
    expect(checked('New lead')).toBe(false);
    expect(checked('Open')).toBe(true);
    expect(checked('Hot lead')).toBe(false);
    expect(screen.queryByRole('radio', { name: 'Closed' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Retired' })).toBeNull();
    // A stage change asks for no reason unless the stage is a lost one.
    expect(screen.queryByText('Lost reason')).toBeNull();
  });

  it('changes the stage and sends only that, with the row version that was read', async () => {
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'enrolled', rowVersion: 4 });
    await show();
    await openSheet();
    await fireEvent.press(radio('Enrolled'));
    expect(checked('Enrolled')).toBe(true);
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
    expect(screen.queryByRole('header', { name: 'Change lifecycle stage' })).toBeNull();
  });

  it('changes the status on its own', async () => {
    updateCall.mockResolvedValue({ ...profile, status: 'Hot', rowVersion: 4 });
    await show();
    await openSheet();
    await fireEvent.press(radio('Hot lead'));
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

  it('drops a status that does not belong to the stage it moves to', async () => {
    getCall.mockResolvedValue({ ...profile, status: 'Hot' });
    updateCall.mockResolvedValue({
      ...profile,
      lifecycleStage: 'new',
      status: 'Open',
      rowVersion: 4,
    });
    await show();
    await openSheet();
    expect(checked('Hot lead')).toBe(true);
    await fireEvent.press(radio('New lead'));
    expect(screen.queryByRole('radio', { name: 'Hot lead' })).toBeNull();
    expect(checked('Open')).toBe(false);
    await save();
    // The status is left to the API, which gives the new stage's own.
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        { lifecycleStage: 'new', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('closes without a request when nothing changed', async () => {
    await show();
    await openSheet();
    await save();
    expect(updateCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('header', { name: 'Change lifecycle stage' })).toBeNull();
  });

  it('closes on back without saving', async () => {
    await show();
    await openSheet();
    await fireEvent.press(radio('Enrolled'));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('header', { name: 'Change lifecycle stage' })).toBeNull();
    expect(updateCall).not.toHaveBeenCalled();
    // Opened again, it starts from the contact, not from the abandoned choice.
    await openSheet();
    expect(checked('Qualified')).toBe(true);
  });
});

describe('LifecycleCard lost stage', () => {
  it('asks why before moving a contact into a lost stage', async () => {
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', rowVersion: 4 });
    await show();
    await openSheet();
    await fireEvent.press(radio('Lost'));
    expect(screen.getByText('Lost reason')).toBeTruthy();
    // The statuses follow the stage.
    expect(screen.getByRole('radio', { name: 'Closed' })).toBeTruthy();
    await save();
    expect(await screen.findByText('Say why this contact was lost.')).toBeTruthy();
    expect(updateCall).not.toHaveBeenCalled();
    await fireEvent.press(radio('Too expensive'));
    expect(screen.queryByText('Say why this contact was lost.')).toBeNull();
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
    await fireEvent.press(radio('Lost'));
    expect(screen.queryByLabelText('Describe the reason')).toBeNull();
    await fireEvent.press(radio('Other'));
    await save();
    expect(await screen.findByText('Say why this contact was lost.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Describe the reason'), ' Moved abroad ');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        profile.id,
        {
          lifecycleStage: 'lost',
          otherLostReason: 'Moved abroad',
          lostReason: null,
          rowVersion: 3,
        },
        expect.any(String),
      ),
    );
  });

  it('asks for words alone when the workspace has no lost reasons', async () => {
    statusCall.mockResolvedValue(statusOptions.filter((o) => o.optionGroup !== 'lost_reason'));
    updateCall.mockResolvedValue({ ...profile, lifecycleStage: 'lost', rowVersion: 4 });
    await show();
    await openSheet();
    await fireEvent.press(radio('Lost'));
    expect(screen.queryByRole('radio', { name: 'Other' })).toBeNull();
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
    await openSheet();
    expect(screen.queryByText('Lost reason')).toBeNull();
    await fireEvent.press(radio('Open'));
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
    await fireEvent.press(radio('Enrolled'));
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
        { lifecycleStage: 'enrolled', rowVersion: 4 },
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Enrolled')).toBeTruthy();
  });

  it('says a reason is required when the API asks for one', async () => {
    updateCall.mockRejectedValue(new ApiError(422, 'CON_LOST_REASON_REQUIRED', 'no'));
    await changeStage();
    expect(await screen.findByText('Say why this contact was lost.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Change lifecycle stage' })).toBeTruthy();
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
