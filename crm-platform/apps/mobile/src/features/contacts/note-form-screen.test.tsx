import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  contactId,
  noteA,
  noteB,
  notes,
  pageOf,
  sessionFull,
  sessionNoContacts,
  sessionReadOnly,
} from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import * as api from './notes-api';
import { ContactNoteFormScreen, NOTE_MAX_LENGTH } from './note-form-screen';

jest.mock('./notes-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContactNotes);
const createCall = jest.mocked(api.createContactNote);
const updateCall = jest.mocked(api.updateContactNote);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show(params: { noteId?: string } = {}) {
  jest.mocked(useLocalSearchParams).mockReturnValue({ contactId, ...params });
  const view = await renderApp(<ContactNoteFormScreen />);
  client = view.queryClient;
  return view;
}

/** Waits until every request has finished, so no update lands after the test. */
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

const field = () => screen.getByLabelText('Note');

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionFull);
  listCall.mockResolvedValue(pageOf(notes));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('ContactNoteFormScreen: a new note', () => {
  it('shows an empty field with its prompt and a counter', async () => {
    const { queryClient } = await show();
    expect(await screen.findByRole('header', { name: 'Add note' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Write your note here...')).toBeTruthy();
    expect(field().props.multiline).toBe(true);
    expect(field().props.numberOfLines).toBe(10);
    expect(field().props.maxLength).toBe(NOTE_MAX_LENGTH);
    expect(screen.getByText('0/400')).toBeTruthy();
    await fireEvent.changeText(field(), 'Hello');
    expect(screen.getByText('5/400')).toBeTruthy();
    expect(screen.getByLabelText('5 of 400 characters used')).toBeTruthy();
    // Nothing is loaded for a note that does not exist yet.
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
  });

  it('will not save an empty note', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Note'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(screen.getByText('Write a note before saving.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
    // Typing clears the message.
    await fireEvent.changeText(field(), 'Text');
    expect(screen.queryByText('Write a note before saving.')).toBeNull();
  });

  it('saves the trimmed text with an idempotency key, and goes back', async () => {
    createCall.mockResolvedValue({ ...noteA, body: 'Call back on Monday' });
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Note'), '  Call back on Monday \n');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        contactId,
        { body: 'Call back on Monday' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('reloads the notes and the timeline after a note is saved', async () => {
    createCall.mockResolvedValue(noteA);
    const { queryClient } = await show();
    queryClient.setQueryData(['contacts', 'notes', contactId], { pages: [], pageParams: [] });
    queryClient.setQueryData(['contacts', 'activities', contactId], { pages: [], pageParams: [] });
    await fireEvent.changeText(await screen.findByLabelText('Note'), 'Text');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(queryClient.getQueryState(['contacts', 'notes', contactId])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['contacts', 'activities', contactId])?.isInvalidated).toBe(
      true,
    );
  });

  it('shows a failure, keeps what was typed, and lets the person save again', async () => {
    createCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    createCall.mockResolvedValueOnce(noteA);
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Note'), 'Keep me');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    expect(field().props.value).toBe('Keep me');
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    // A lost connection repeats the same request, so the key is the same.
    expect(createCall.mock.calls[1]?.[2]).toBe(createCall.mock.calls[0]?.[2]);
  });

  it('shows what the server refused under the field', async () => {
    createCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
        { path: 'body', message: 'too long' },
      ]),
    );
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Note'), 'Text');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Enter a note of up to 400 characters.')).toBeTruthy();
  });

  it('goes back from the arrow, to the notes when there is nowhere to go back to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/contact-notes',
      params: { contactId },
    });
  });
});

describe('ContactNoteFormScreen: changing a note', () => {
  it('fills the field with the note and sends the new text with the row version it read', async () => {
    updateCall.mockResolvedValue({ ...noteB, body: 'Sent the new price list.', rowVersion: 4 });
    await show({ noteId: noteB.id });
    expect(await screen.findByRole('header', { name: 'Update note' })).toBeTruthy();
    await waitFor(() => expect(field().props.value).toBe(noteB.body));
    await fireEvent.changeText(field(), 'Sent the new price list.');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        contactId,
        noteB.id,
        { body: 'Sent the new price list.', rowVersion: 3 },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('sends nothing when the text was not changed', async () => {
    await show({ noteId: noteA.id });
    await waitFor(() => expect(field().props.value).toBe(noteA.body));
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(updateCall).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('looks on the next pages for a note that is not on the first one', async () => {
    listCall.mockResolvedValueOnce(pageOf([noteA], 'cursor-2'));
    listCall.mockResolvedValueOnce(pageOf([noteB]));
    await show({ noteId: noteB.id });
    await waitFor(() => expect(field().props.value).toBe(noteB.body));
    expect(listCall).toHaveBeenLastCalledWith(
      contactId,
      { limit: 20, cursor: 'cursor-2' },
      expect.anything(),
    );
  });

  it('says so when the note is not there any more', async () => {
    listCall.mockResolvedValue(pageOf([noteA]));
    await show({ noteId: noteB.id });
    expect(await screen.findByText('This note no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  });

  it('reloads the note and asks for another look when someone else saved first', async () => {
    updateCall.mockRejectedValueOnce(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
    await show({ noteId: noteB.id });
    await waitFor(() => expect(field().props.value).toBe(noteB.body));
    listCall.mockResolvedValue(
      pageOf([noteA, { ...noteB, body: 'Sent the price list and the brochure.', rowVersion: 4 }]),
    );
    await fireEvent.changeText(field(), 'My own change');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(
      await screen.findByText('This note was changed by someone else. Review and save again.'),
    ).toBeTruthy();
    expect(listCall).toHaveBeenCalledTimes(2);
    // The field now holds the other person's text, and saving again carries the new row version.
    await waitFor(() => expect(field().props.value).toBe('Sent the price list and the brochure.'));
    updateCall.mockResolvedValueOnce({ ...noteB, rowVersion: 5 });
    await fireEvent.changeText(field(), 'Merged text');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenLastCalledWith(
        contactId,
        noteB.id,
        { body: 'Merged text', rowVersion: 4 },
        expect.any(String),
      ),
    );
  });

  it('says so when the note was deleted while it was open', async () => {
    updateCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show({ noteId: noteB.id });
    await waitFor(() => expect(field().props.value).toBe(noteB.body));
    listCall.mockResolvedValue(pageOf([noteA]));
    await fireEvent.changeText(field(), 'Late edit');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('This note no longer exists.')).toBeTruthy();
  });

  it('shows a failure to load the notes with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show({ noteId: noteA.id });
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(field().props.value).toBe(noteA.body));
  });

  it('says so when the contact no longer exists', async () => {
    listCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show({ noteId: noteA.id });
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });
});

describe('ContactNoteFormScreen: permissions', () => {
  it('refuses a person who may only read, and asks for nothing', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    const { queryClient } = await show({ noteId: noteA.id });
    expect(await screen.findByText("You can't change notes")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  });

  it('refuses a person without contacts, on the add form too', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    await show();
    expect(await screen.findByText("You can't change notes")).toBeTruthy();
    expect(screen.queryByLabelText('Note')).toBeNull();
  });

  it('says so when no contact was given', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    const view = await renderApp(<ContactNoteFormScreen />);
    client = view.queryClient;
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });
});
