import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import {
  clearReceivedFiles,
  downloadReceivedFile,
  isRiskyFile,
  openReceivedFile,
  safeFileName,
} from './received-files';

interface FakeDir {
  name: string;
  exists: boolean;
  delete: jest.Mock;
  create: jest.Mock;
  list: jest.Mock;
}
const makeDir = (name: string, over: Partial<FakeDir> = {}): FakeDir => ({
  name,
  exists: true,
  delete: jest.fn(),
  create: jest.fn(),
  list: jest.fn(() => []),
  ...over,
});

jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  Directory: jest.fn(),
  File: Object.assign(jest.fn(), { downloadFileAsync: jest.fn() }),
}));
jest.mock('expo-file-system/legacy', () => ({ getContentUriAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const download = jest.mocked(File.downloadFileAsync);
const share = jest.mocked(Sharing.shareAsync);
const sharingAvailable = jest.mocked(Sharing.isAvailableAsync);
const launch = jest.mocked(IntentLauncher.startActivityAsync);
const contentUri = jest.mocked(getContentUriAsync);
const saved = { uri: 'file:///cache/received/1-abc/report.pdf' } as unknown as File;

let root: FakeDir;
let made: FakeDir[];

beforeEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  jest.useRealTimers();
  root = makeDir('received');
  made = [];
  jest.mocked(Directory).mockImplementation(((parent: unknown, name?: string) => {
    if (name === undefined || name === 'received') return root;
    const dir = makeDir(name);
    made.push(dir);
    return dir;
  }) as never);
  jest.mocked(File).mockImplementation(((_dir: unknown, name: string) => ({ name })) as never);
  download.mockResolvedValue(saved);
  sharingAvailable.mockResolvedValue(true);
  contentUri.mockResolvedValue('content://app.fileprovider/received/report.pdf');
});

describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('Invoice 2026.pdf')).toBe('Invoice 2026.pdf');
  });
  it('drops any folder part, so a name cannot leave the folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\x\\a.pdf')).toBe('a.pdf');
  });
  it('removes control characters and leading dots, and never answers empty', () => {
    expect(safeFileName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(safeFileName('.hidden')).toBe('hidden');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName(null)).toBe('file');
    expect(safeFileName('../')).toBe('file');
  });
  it('replaces the characters that break a file address or a file system', () => {
    expect(safeFileName('50% off #1?.pdf')).toBe('50_ off _1_.pdf');
    expect(safeFileName('a:b|c*d.txt')).toBe('a_b_c_d.txt');
  });
  it('shortens a very long name by bytes, keeping its ending', () => {
    const name = safeFileName(`${'a'.repeat(300)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });
  it('counts a name in bytes, not characters, and never cuts a character in two', () => {
    const cjk = safeFileName(`${'文'.repeat(100)}.pdf`);
    expect(new TextEncoder().encode(cjk).length).toBeLessThanOrEqual(120);
    expect(cjk.endsWith('.pdf')).toBe(true);
    const emoji = safeFileName(`${'😀'.repeat(60)}.png`);
    expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(120);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('isRiskyFile', () => {
  it('flags an app package, a program, a script or a web page by type or by ending', () => {
    expect(isRiskyFile('application/vnd.android.package-archive', 'x')).toBe(true);
    expect(isRiskyFile('text/html; charset=utf-8', 'page')).toBe(true);
    expect(isRiskyFile('application/octet-stream', 'setup.APK')).toBe(true);
    expect(isRiskyFile('application/octet-stream', 'run.sh')).toBe(true);
  });
  it('lets ordinary documents, pictures, video and audio through', () => {
    expect(isRiskyFile('application/pdf', 'report.pdf')).toBe(false);
    expect(isRiskyFile('video/mp4', null)).toBe(false);
    expect(isRiskyFile('audio/mpeg', 'note.mp3')).toBe(false);
  });
});

describe('downloadReceivedFile', () => {
  it('downloads into a folder of its own, with the token as a header and never in the address', async () => {
    const file = await downloadReceivedFile({
      uri: 'http://api.test/v2/media/abc',
      token: 'tok',
      name: '../report.pdf',
    });
    expect(file).toBe(saved);
    expect(made).toHaveLength(1);
    expect(made[0]?.name).toMatch(/^\d+-[0-9a-f]{8}$/);
    expect(made[0]?.create).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
    const [url, target, options] = download.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/v2/media/abc');
    expect(url).not.toContain('tok');
    expect(target).toMatchObject({ name: 'report.pdf' });
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer tok' }, idempotent: true });
  });

  it('gives two downloads two folders, and removes only the old ones', async () => {
    const old = makeDir(`${Date.now() - 60 * 60_000}-aaaaaaaa`);
    const recent = makeDir(`${Date.now() - 60_000}-bbbbbbbb`);
    root.list.mockReturnValue([old, recent]);
    jest
      .spyOn(Crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    await downloadReceivedFile({ uri: 'http://api.test/a', token: 't', name: 'a.pdf' });
    await downloadReceivedFile({ uri: 'http://api.test/b', token: 't', name: 'b.pdf' });
    expect(old.delete).toHaveBeenCalled();
    // A file opened a minute ago may still be in a viewer: it is not deleted by another download.
    expect(recent.delete).not.toHaveBeenCalled();
    expect(made.map((d) => d.name)).toHaveLength(2);
    expect(new Set(made.map((d) => d.name)).size).toBe(2);
  });

  it('removes what is not a download of ours (no time in its name)', async () => {
    const stray = makeDir('notes');
    root.list.mockReturnValue([stray]);
    await downloadReceivedFile({ uri: 'http://api.test/a', token: 't', name: 'a.pdf' });
    expect(stray.delete).toHaveBeenCalled();
  });

  it('leaves nothing behind when the download fails, and lets the failure reach the caller', async () => {
    download.mockRejectedValue(new Error('HTTP 401'));
    await expect(
      downloadReceivedFile({ uri: 'http://api.test/x', token: 't', name: 'a.pdf' }),
    ).rejects.toThrow('HTTP 401');
    expect(made[0]?.delete).toHaveBeenCalled();
  });
});

describe('openReceivedFile', () => {
  it('on Android opens the file in the viewer app, with permission to read only that file', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    launch.mockResolvedValue({ resultCode: 0 } as never);
    await expect(
      openReceivedFile(saved, 'application/pdf', 'Open file', 'report.pdf'),
    ).resolves.toBe('opened');
    expect(launch).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://app.fileprovider/received/report.pdf',
      type: 'application/pdf',
      flags: 1,
    });
    expect(share).not.toHaveBeenCalled();
    platform.restore();
  });

  it('does not wait for the viewer to be closed: after a moment the file counts as opened', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
    launch.mockReturnValue(new Promise(() => undefined) as never); // the viewer stays open
    const result = openReceivedFile(saved, 'application/pdf', 'Open file', 'report.pdf');
    await jest.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe('opened');
    expect(share).not.toHaveBeenCalled();
    platform.restore();
  });

  it('on Android falls back to the share sheet when no app can view the type', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    launch.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(openReceivedFile(saved, 'application/x-odd', 'Open file', 'a.odd')).resolves.toBe(
      'opened',
    );
    expect(share).toHaveBeenCalledWith(saved.uri, {
      mimeType: 'application/x-odd',
      dialogTitle: 'Open file',
    });
    platform.restore();
  });

  it('never launches an app package or a script on a tap: it goes to the share sheet', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    await openReceivedFile(
      saved,
      'application/vnd.android.package-archive',
      'Open file',
      'update.apk',
    );
    expect(launch).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledTimes(1);
    platform.restore();
  });

  it('on iOS shows the share sheet (Save to Files, Open in…)', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    await expect(openReceivedFile(saved, 'application/pdf', 'Open file')).resolves.toBe('opened');
    expect(launch).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledTimes(1);
    platform.restore();
  });

  it('says so when the phone cannot offer the file at all', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'ios');
    sharingAvailable.mockResolvedValue(false);
    await expect(openReceivedFile(saved, 'application/pdf', 'Open file')).resolves.toBe('noApp');
    expect(share).not.toHaveBeenCalled();
    platform.restore();
  });
});

describe('clearReceivedFiles', () => {
  it('deletes the folder when it exists, and does nothing when it does not', () => {
    clearReceivedFiles();
    expect(root.delete).toHaveBeenCalledTimes(1);
    root.exists = false;
    clearReceivedFiles();
    expect(root.delete).toHaveBeenCalledTimes(1);
  });

  it('never throws: ending a session must not fail on a file that is in use', () => {
    root.delete.mockImplementation(() => {
      throw new Error('busy');
    });
    expect(() => clearReceivedFiles()).not.toThrow();
  });
});
