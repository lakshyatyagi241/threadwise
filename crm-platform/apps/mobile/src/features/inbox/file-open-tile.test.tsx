import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getAccessToken } from '@/lib/auth/session-manager';
import { initI18n } from '@/lib/i18n';
import * as received from '@/lib/device/received-files';
import { renderApp } from '@/test/render';
import { OpenFileTile } from './file-open-tile';
import { messagesRoot } from './use-inbox';

jest.mock('@/lib/auth/session-manager', () => ({ getAccessToken: jest.fn() }));
jest.mock('@/lib/device/received-files');

const download = jest.mocked(received.downloadReceivedFile);
const open = jest.mocked(received.openReceivedFile);
const file = { uri: 'file:///cache/received/report.pdf' } as never;
const media = {
  url: '/api/v2/media/abc',
  mime: 'application/pdf',
  sizeBytes: 2048,
  name: 'report.pdf',
};

const show = () =>
  renderApp(
    <OpenFileTile
      media={media}
      icon="document-outline"
      label="report.pdf"
      detail="2 KB · application/pdf"
    />,
  );
const press = async () =>
  await fireEvent.press(await screen.findByRole('button', { name: 'Open report.pdf' }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getAccessToken).mockResolvedValue('tok');
  download.mockResolvedValue(file);
  open.mockResolvedValue('opened');
});

describe('OpenFileTile', () => {
  it('shows the name and size as a button the person can press', async () => {
    await show();
    expect(await screen.findByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB · application/pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open report.pdf' })).toBeTruthy();
  });

  it('downloads with the token from the API address, then hands the file to the phone', async () => {
    await show();
    await press();
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(download).toHaveBeenCalledWith({
      uri: 'http://api.test/v2/media/abc',
      token: 'tok',
      name: 'report.pdf',
    });
    expect(open).toHaveBeenCalledWith(file, 'application/pdf', 'Open file', 'report.pdf');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says it is opening while the file downloads, and ignores a second press', async () => {
    let finish: ((f: never) => void) | undefined;
    download.mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
    await show();
    await press();
    expect(await screen.findByText('Opening…')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open report.pdf' }).props.accessibilityState,
    ).toMatchObject({ busy: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Open report.pdf' }));
    expect(download).toHaveBeenCalledTimes(1);
    await act(async () => finish?.(file));
    await waitFor(() => expect(screen.queryByText('Opening…')).toBeNull());
  });

  it('says so, and reads the messages again for a fresh link, when the download fails', async () => {
    download.mockRejectedValue(new Error('HTTP 401'));
    const { queryClient } = await show();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await press();
    expect(await screen.findByText("Couldn't open this file. Try again.")).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messagesRoot });
    expect(open).not.toHaveBeenCalled();
  });

  it('can be tried again after a failure', async () => {
    download.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(file);
    await show();
    await press();
    await screen.findByText("Couldn't open this file. Try again.");
    await press();
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says so when no app on the phone can open that type', async () => {
    open.mockResolvedValue('noApp');
    await show();
    await press();
    expect(
      await screen.findByText('No app on this phone can open this type of file.'),
    ).toBeTruthy();
  });

  it('says it could not open the file when the person is signed out, without calling the server', async () => {
    jest.mocked(getAccessToken).mockResolvedValue(null);
    await show();
    await press();
    expect(await screen.findByText("Couldn't open this file. Try again.")).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
  });

  it('sends the token only to the API: a link to another address is refused before any request', async () => {
    const view = await renderApp(
      <OpenFileTile
        media={{ ...media, url: 'https://cdn.elsewhere.test/x.pdf' }}
        icon="document-outline"
        label="report.pdf"
        detail=""
      />,
    );
    expect(view).toBeTruthy();
    await press();
    expect(await screen.findByText("Couldn't open this file. Try again.")).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
  });

  it('starts one download for two quick presses, before the screen has redrawn', async () => {
    let finish: ((f: never) => void) | undefined;
    download.mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
    await show();
    const button = await screen.findByRole('button', { name: 'Open report.pdf' });
    await act(async () => {
      await fireEvent.press(button);
      await fireEvent.press(button);
    });
    expect(download).toHaveBeenCalledTimes(1);
    await act(async () => finish?.(file));
  });

  it('does not touch the screen when the tile is gone before the download ends', async () => {
    let finish: ((f: never) => void) | undefined;
    download.mockImplementation(() => new Promise((resolve) => (finish = resolve as never)));
    const view = await show();
    await press();
    await waitFor(() => expect(download).toHaveBeenCalled());
    await view.unmount();
    await act(async () => finish?.(file));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
