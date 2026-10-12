import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, fireEvent } from '@testing-library/react-native';
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
import { reachEnd } from '@/test/scroll';
import { formatMoment } from './contact-display';
import * as api from './notes-api';
import { ContactNotesScreen } from './notes-screen';

jest.mock('./notes-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContactNotes);
const deleteCall = jest.mocked(api.deleteContactNote);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactNotesScreen />);
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
  jest.mocked(useLocalSearchParams).mockReturnValue({ contactId });
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

describe('ContactNotesScreen', () => {
  it('lists the notes with when they were written, and marks the one that was edited', async () => {
    await show();
    expect(await screen.findByText(noteA.body)).toBeTruthy();
    expect(screen.getByText(noteB.body)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByText(formatMoment(noteA.createdAt, 'en')!)).toBeTruthy();
    expect(screen.getByText(`${formatMoment(noteB.createdAt, 'en')} · Edited`)).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(
      contactId,
      { limit: 20, cursor: undefined },
      expect.anything(),
    );
  });

  it('shows placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof pageOf<typeof noteA>>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(await screen.findAllByTestId('note-skeleton-row')).toHaveLength(6);
    await act(async () => finish(pageOf(notes)));
    expect(await screen.findByText(noteA.body)).toBeTruthy();
    expect(screen.queryAllByTestId('note-skeleton-row')).toHaveLength(0);
  });

  it('says there are no notes, and points at the + button for people who can add one', async () => {
    listCall.mockResolvedValue(pageOf([]));
    await show();
    expect(await screen.findByText('No notes available.')).toBeTruthy();
    expect(screen.getByText('Tap the + button to add the first note.')).toBeTruthy();
  });

  it('keeps the + hint away from people who cannot add notes', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    listCall.mockResolvedValue(pageOf([]));
    await show();
    expect(await screen.findByText('No notes available.')).toBeTruthy();
    expect(screen.queryByText('Tap the + button to add the first note.')).toBeNull();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(noteA.body)).toBeTruthy();
  });

  it('says so when the contact no longer exists', async () => {
    listCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });

  it('tells a person the API refuses (403) instead of showing a retry', async () => {
    listCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText("You can't view notes")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('tells a person without the permission, and asks for nothing', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view notes")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
  });

  it('asks for the next page when the end is reached, and stops when there is none', async () => {
    listCall.mockResolvedValueOnce(pageOf([noteA], 'cursor-2'));
    listCall.mockResolvedValueOnce(pageOf([noteB]));
    const { queryClient } = await show();
    await screen.findByText(noteA.body);
    await reachEnd(screen.getByTestId('notes-list'));
    expect(await screen.findByText(noteB.body)).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(
      contactId,
      { limit: 20, cursor: 'cursor-2' },
      expect.anything(),
    );
    await settled(queryClient);
    await reachEnd(screen.getByTestId('notes-list'));
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('reloads the list when the page is pulled down, and stops the spinner when done', async () => {
    const { queryClient } = await show();
    await screen.findByText(noteA.body);
    const control = () => screen.getByTestId('notes-list').props.refreshControl;
    await act(() => {
      control().props.onRefresh();
    });
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    await settled(queryClient);
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('goes back, to the contact when there is nowhere to go back to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: contactId },
    });
  });

  describe('for a person who may change notes', () => {
    it('adds a note with the round button', async () => {
      await show();
      await screen.findByText(noteA.body);
      await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact-note',
        params: { contactId },
      });
    });

    it('opens the edit form when a row is pressed', async () => {
      await show();
      await fireEvent.press(await screen.findByText(noteB.body));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact-note',
        params: { contactId, noteId: noteB.id },
      });
    });

    it('offers edit and delete in the menu of a note', async () => {
      await show();
      await screen.findByText(noteA.body);
      const [first] = screen.getAllByRole('button', { name: /^Actions for the note from/ });
      await fireEvent.press(first!);
      await fireEvent.press(screen.getByRole('button', { name: 'Edit note' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact-note',
        params: { contactId, noteId: noteA.id },
      });
      expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull();
    });

    it('asks before deleting, and deletes only after the person agrees', async () => {
      deleteCall.mockResolvedValue(undefined);
      await show();
      await screen.findByText(noteA.body);
      await fireEvent.press(
        screen.getAllByRole('button', { name: /^Actions for the note from/ })[0]!,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete note' }));
      expect(screen.getByRole('header', { name: 'Delete note' })).toBeTruthy();
      expect(screen.getByText('Are you sure you want to delete this note?')).toBeTruthy();

      // Backing out sends nothing.
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(deleteCall).not.toHaveBeenCalled();
      expect(screen.queryByText('Are you sure you want to delete this note?')).toBeNull();

      await fireEvent.press(
        screen.getAllByRole('button', { name: /^Actions for the note from/ })[0]!,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete note' }));
      listCall.mockResolvedValue(pageOf([noteB]));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(contactId, noteA.id));
      await waitFor(() =>
        expect(screen.queryByText('Are you sure you want to delete this note?')).toBeNull(),
      );
      // The list reloads without the deleted note.
      await waitFor(() => expect(screen.queryByText(noteA.body)).toBeNull());
      expect(screen.getByText(noteB.body)).toBeTruthy();
    });

    it('says when a delete failed', async () => {
      deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await screen.findByText(noteA.body);
      await fireEvent.press(
        screen.getAllByRole('button', { name: /^Actions for the note from/ })[0]!,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete note' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      expect(screen.queryByText('Are you sure you want to delete this note?')).toBeNull();
    });

    it('does not complain when the note was already deleted by someone else', async () => {
      deleteCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
      await show();
      await screen.findByText(noteA.body);
      await fireEvent.press(
        screen.getAllByRole('button', { name: /^Actions for the note from/ })[0]!,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete note' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(screen.queryByText('Are you sure you want to delete this note?')).toBeNull(),
      );
      expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
    });
  });

  describe('for a person who may only read', () => {
    beforeEach(() => sessionCall.mockResolvedValue(sessionReadOnly));

    it('shows the notes without the add button, the menu or the edit form', async () => {
      await show();
      await fireEvent.press(await screen.findByText(noteA.body));
      expect(router.push).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull();
      expect(screen.queryAllByRole('button', { name: /^Actions for the note from/ })).toHaveLength(
        0,
      );
    });
  });
});
