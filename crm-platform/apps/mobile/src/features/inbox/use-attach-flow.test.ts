import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';
import * as pickers from './pick-attachment';
import { useAttachFlow } from './use-attach-flow';

jest.mock('./pick-attachment');
jest.mock('@/lib/device/open-settings', () => ({ openPermissionSettings: jest.fn() }));

const library = jest.mocked(pickers.pickFromLibrary);
const PHOTO = {
  uri: 'file:///p.jpg',
  name: 'p.jpg',
  mime: 'image/jpeg',
  sizeBytes: 100,
  kind: 'image',
} as const;

beforeEach(() => {
  jest.resetAllMocks();
  library.mockResolvedValue({ status: 'picked', attachment: PHOTO });
});

describe('useAttachFlow', () => {
  it('opens the picker at once on Android, after closing the sheet', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.open());
    expect(result.current.menuOpen).toBe(true);
    await act(async () => result.current.choose('library'));
    expect(result.current.menuOpen).toBe(false);
    expect(library).toHaveBeenCalledTimes(1);
    expect(result.current.file).toEqual(PHOTO);
    platform.restore();
  });

  it('waits for the sheet to finish leaving on iOS, and opens the picker once', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.open());
    await act(async () => result.current.choose('library'));
    expect(library).not.toHaveBeenCalled();
    await act(async () => result.current.onMenuDismissed());
    expect(library).toHaveBeenCalledTimes(1);
    expect(result.current.file).toEqual(PHOTO);
    // A second "dismissed" (the sheet closed by the backdrop) must not open a picker nobody asked for.
    await act(async () => result.current.onMenuDismissed());
    expect(library).toHaveBeenCalledTimes(1);
    platform.restore();
  });

  it('does not open a picker when the sheet is closed without a choice', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.open());
    await act(async () => result.current.closeMenu());
    await act(async () => result.current.onMenuDismissed());
    expect(library).not.toHaveBeenCalled();
    platform.restore();
  });

  it('keeps no file and says why when the chosen one is empty', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    library.mockResolvedValue({ status: 'picked', attachment: { ...PHOTO, sizeBytes: 0 } });
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.choose('library'));
    expect(result.current.file).toBeNull();
    expect(result.current.notice).toEqual({ kind: 'empty' });
    platform.restore();
  });

  it('clears an old notice when the sheet is opened again', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    library.mockResolvedValue({ status: 'failed' });
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.choose('library'));
    expect(result.current.notice).toEqual({ kind: 'pickFailed' });
    await act(async () => result.current.open());
    expect(result.current.notice).toBeNull();
    platform.restore();
  });
});

describe('useAttachFlow: guards', () => {
  it('ignores a second tap while a picker is open', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    let finish: (() => void) | undefined;
    library.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'picked', attachment: PHOTO });
        }),
    );
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => {
      result.current.choose('library');
      result.current.choose('library');
    });
    expect(library).toHaveBeenCalledTimes(1);
    await act(async () => finish?.());
    expect(result.current.file).toEqual(PHOTO);
    platform.restore();
  });

  it('forgets a choice that never got its "dismissed" event when the sheet is opened again', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.choose('library'));
    await act(async () => result.current.open());
    await act(async () => result.current.onMenuDismissed());
    expect(library).not.toHaveBeenCalled();
    platform.restore();
  });

  it('removes the app’s copy of a file that is too large, and of one the person drops', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const big = { ...PHOTO, sizeBytes: 6 * 1024 * 1024 };
    library.mockResolvedValueOnce({ status: 'picked', attachment: big });
    const { result } = await renderHook(() => useAttachFlow());
    await act(async () => result.current.choose('library'));
    expect(pickers.discardAttachment).toHaveBeenCalledWith(big);
    expect(result.current.file).toBeNull();

    await act(async () => result.current.choose('library'));
    expect(result.current.file).toEqual(PHOTO);
    await act(async () => result.current.closeFile());
    expect(pickers.discardAttachment).toHaveBeenCalledWith(PHOTO);
    expect(result.current.file).toBeNull();
    platform.restore();
  });
});
