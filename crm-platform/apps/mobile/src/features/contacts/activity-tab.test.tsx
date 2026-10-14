import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  activities,
  callEntry,
  contactId,
  noteA,
  noteB,
  notes,
  pageOf,
  sessionFull,
  sessionNoContacts,
  sessionReadOnly,
  systemEntry,
} from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import * as activityApi from './activity-api';
import { ActivityTab } from './activity-tab';
import { formatMoment } from './contact-display';
import * as notesApi from './notes-api';

jest.mock('./activity-api');
jest.mock('./notes-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(activityApi.listContactActivities);
const createCall = jest.mocked(activityApi.createContactActivity);
const notesCall = jest.mocked(notesApi.listContactNotes);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show(canUpdate = true, hideTiles = false) {
  const view = await renderApp(
    <ActivityTab contactId={contactId} canUpdate={canUpdate} hideTiles={hideTiles} />,
  );
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
  listCall.mockResolvedValue(pageOf(activities));
  notesCall.mockResolvedValue(pageOf(notes));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('ActivityTab: the tiles', () => {
  it('counts the notes that are loaded and opens them', async () => {
    await show();
    const tile = await screen.findByRole('button', { name: 'Notes, 2' });
    expect(within(tile).getByText('2')).toBeTruthy();
    expect(notesCall).toHaveBeenCalledWith(
      contactId,
      { limit: 20, cursor: undefined },
      expect.anything(),
    );
    await fireEvent.press(tile);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/contact-notes', params: { contactId } });
  });

  it('adds a plus when there are more notes than the first page', async () => {
    notesCall.mockResolvedValue(pageOf([noteA, noteB], 'cursor-2'));
    await show();
    expect(await screen.findByRole('button', { name: 'Notes, 2+' })).toBeTruthy();
  });

  it('shows no number while the notes load or when they could not be loaded', async () => {
    notesCall.mockRejectedValue(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(await screen.findByRole('button', { name: 'Notes' })).toBeTruthy();
  });

  it('opens the tasks of the contact for a person who may read tasks, without a number', async () => {
    await show();
    const tile = await screen.findByRole('button', { name: 'Tasks' });
    await fireEvent.press(tile);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/tasks', params: { contactId } });
  });

  it('leaves the tasks tile out for a person who may not read tasks', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    await show(false);
    await screen.findByRole('button', { name: /^Notes/ });
    expect(screen.queryByRole('button', { name: 'Tasks' })).toBeNull();
  });
});

describe('ActivityTab: without the tiles', () => {
  it('leaves the notes and tasks tiles out and keeps the timeline', async () => {
    await show(true, true);
    expect(await screen.findByText('Timeline')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Notes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Tasks/ })).toBeNull();
  });
});

describe('ActivityTab: the timeline', () => {
  it('lists the entries with their kind and when they happened', async () => {
    await show();
    expect(await screen.findByText('Called about the demo')).toBeTruthy();
    expect(screen.getByText('Booked for Friday.')).toBeTruthy();
    expect(screen.getByText(`Call · ${formatMoment(callEntry.occurredAt, 'en')}`)).toBeTruthy();
    // A kind the app has no word for is tidied up, and an entry the system wrote says so.
    expect(screen.getByText('Filled in the enquiry form')).toBeTruthy();
    expect(
      screen.getByText(`Form submission · ${formatMoment(systemEntry.occurredAt, 'en')}`),
    ).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Timeline' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(
      contactId,
      { limit: 20, cursor: undefined },
      expect.anything(),
    );
  });

  it('says there is no activity yet', async () => {
    listCall.mockResolvedValue(pageOf([]));
    await show();
    expect(await screen.findByText('No activity yet.')).toBeTruthy();
  });

  it('loads the next page on request, and the button goes when there are no more', async () => {
    listCall.mockResolvedValueOnce(pageOf([callEntry], 'cursor-2'));
    listCall.mockResolvedValueOnce(pageOf([systemEntry]));
    await show();
    await screen.findByText('Called about the demo');
    expect(screen.queryByText('Filled in the enquiry form')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Filled in the enquiry form')).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(
      contactId,
      { limit: 20, cursor: 'cursor-2' },
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Called about the demo')).toBeTruthy();
  });

  it('asks for nothing when the person may not read contacts', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    await waitFor(() => expect(sessionCall).toHaveBeenCalled());
    await settled(queryClient);
    await act(async () => undefined);
    expect(listCall).not.toHaveBeenCalled();
    expect(notesCall).not.toHaveBeenCalled();
  });
});

describe('ActivityTab: logging an entry', () => {
  const open = async () => {
    await fireEvent.press(await screen.findByRole('button', { name: 'Add activity' }));
    return screen.getByLabelText('Title');
  };
  const save = () => fireEvent.press(screen.getByRole('button', { name: 'Save activity' }));

  it('offers the button only to a person who may update contacts', async () => {
    await show(false);
    await screen.findByText('Called about the demo');
    expect(screen.queryByRole('button', { name: 'Add activity' })).toBeNull();
  });

  it('starts with the type "note" and sends the entry, then reloads the timeline', async () => {
    createCall.mockResolvedValue(callEntry);
    await show();
    await open();
    expect(screen.getByLabelText('Type').props.value).toBe('note');
    await fireEvent.changeText(screen.getByLabelText('Title'), '  Met at the expo ');
    await fireEvent.changeText(screen.getByLabelText('Details'), 'Gave a brochure');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        contactId,
        { activityType: 'note', title: 'Met at the expo', body: 'Gave a brochure' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
    await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
  });

  it('leaves the details out when they are empty and takes another type', async () => {
    createCall.mockResolvedValue(callEntry);
    await show();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Type'), 'call');
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Rang twice');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        contactId,
        { activityType: 'call', title: 'Rang twice' },
        expect.any(String),
      ),
    );
  });

  it('asks for a title and a type before sending anything', async () => {
    await show();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Type'), '  ');
    await save();
    expect(screen.getByText('Enter a type of up to 100 characters.')).toBeTruthy();
    expect(screen.getByText('Enter a title of up to 255 characters.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('closes without sending when the person cancels', async () => {
    await show();
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('shows what the server refused under the field', async () => {
    createCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'title', message: 'bad' },
      ]),
    );
    await show();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Hello');
    await save();
    expect(await screen.findByText('Enter a title of up to 255 characters.')).toBeTruthy();
  });

  it('shows another failure above the fields and keeps the form open', async () => {
    createCall.mockRejectedValue(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    await open();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Hello');
    await save();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Title').props.value).toBe('Hello');
  });
});
