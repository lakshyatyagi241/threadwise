import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  contactId,
  files,
  mysteryFile,
  pageOf,
  pdfFile,
  sessionFull,
  sessionNoContacts,
  sessionReadOnly,
} from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import { formatDate } from './contact-display';
import * as api from './files-api';
import { FilesTab, formatFileSize } from './files-tab';

jest.mock('./files-api');
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContactFiles);
const deleteCall = jest.mocked(api.deleteContactFile);

let client: QueryClient | undefined;
async function show(canUpdate = true) {
  const view = await renderApp(<FilesTab contactId={contactId} canUpdate={canUpdate} />);
  client = view.queryClient;
  return view;
}

/** Waits until every request has finished, so no update lands after the test. */
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  sessionCall.mockResolvedValue(sessionFull);
  listCall.mockResolvedValue(pageOf(files));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [812, '812 B'],
    [1024, '1 KB'],
    [12 * 1024, '12 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5 MB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
    [3 * 1024 ** 3, '3 GB'],
    [2 * 1024 ** 5, '2,048 TB'],
  ])('writes %d bytes as %s', (bytes, text) => {
    expect(formatFileSize(bytes, 'en')).toBe(text);
  });

  it('has no size to write when the API does not know it', () => {
    expect(formatFileSize(null, 'en')).toBeNull();
    expect(formatFileSize(-1, 'en')).toBeNull();
  });
});

describe('FilesTab', () => {
  it('lists the files with their name, size and date', async () => {
    await show();
    expect(await screen.findByText('Price list.pdf')).toBeTruthy();
    expect(screen.getByText(`12 KB · ${formatDate(pdfFile.createdAt, 'en')}`)).toBeTruthy();
    // A file with no recorded size or type shows just its date.
    expect(screen.getByText('scan-001')).toBeTruthy();
    expect(screen.getByText(formatDate(mysteryFile.createdAt, 'en')!)).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(
      contactId,
      { limit: 20, cursor: undefined },
      expect.anything(),
    );
  });

  it('has no way to add or open a file: the API cannot take or give the bytes', async () => {
    await show();
    await screen.findByText('Price list.pdf');
    expect(screen.queryByRole('button', { name: /add|upload|open|download/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says there are no files', async () => {
    listCall.mockResolvedValue(pageOf([]));
    await show();
    expect(await screen.findByText('No files available.')).toBeTruthy();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Price list.pdf')).toBeTruthy();
  });

  it('loads the next page on request, and the button goes when there are no more', async () => {
    listCall.mockResolvedValueOnce(pageOf([pdfFile], 'cursor-2'));
    listCall.mockResolvedValueOnce(pageOf([mysteryFile]));
    await show();
    await screen.findByText('Price list.pdf');
    await fireEvent.press(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('scan-001')).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(
      contactId,
      { limit: 20, cursor: 'cursor-2' },
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('asks for nothing when the person may not read contacts', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    await waitFor(() => expect(sessionCall).toHaveBeenCalled());
    await settled(queryClient);
    await act(async () => undefined);
    expect(listCall).not.toHaveBeenCalled();
  });

  describe('deleting', () => {
    it('asks first, and deletes only after the person agrees', async () => {
      deleteCall.mockResolvedValue(undefined);
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Delete file Price list.pdf' }),
      );
      expect(screen.getByRole('header', { name: 'Delete file' })).toBeTruthy();
      expect(screen.getByText('Are you sure you want to delete this file?')).toBeTruthy();

      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(deleteCall).not.toHaveBeenCalled();
      expect(screen.queryByText('Are you sure you want to delete this file?')).toBeNull();

      await fireEvent.press(screen.getByRole('button', { name: 'Delete file Price list.pdf' }));
      listCall.mockResolvedValue(pageOf([mysteryFile]));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(contactId, pdfFile.id));
      await waitFor(() => expect(screen.queryByText('Price list.pdf')).toBeNull());
      expect(screen.getByText('scan-001')).toBeTruthy();
      expect(screen.queryByText('Are you sure you want to delete this file?')).toBeNull();
    });

    it('says when the delete failed', async () => {
      deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Delete file Price list.pdf' }),
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      expect(
        await screen.findByText('The server took too long to answer. Please try again.'),
      ).toBeTruthy();
      expect(screen.getByText('Price list.pdf')).toBeTruthy();
    });

    it('does not complain about a file that someone else already deleted', async () => {
      deleteCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
      await show();
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Delete file Price list.pdf' }),
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(screen.queryByText('Are you sure you want to delete this file?')).toBeNull(),
      );
      expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
    });

    it('is not offered to a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionReadOnly);
      await show(false);
      expect(await screen.findByText('Price list.pdf')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Delete file/ })).toBeNull();
    });
  });
});
