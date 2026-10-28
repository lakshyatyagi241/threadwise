import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import {
  discardAttachment,
  pickAudio,
  pickDocument,
  pickFromCamera,
  pickFromLibrary,
} from './pick-attachment';

const library = jest.mocked(ImagePicker.launchImageLibraryAsync);
const camera = jest.mocked(ImagePicker.launchCameraAsync);
const cameraPermission = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const documents = jest.mocked(DocumentPicker.getDocumentAsync);

const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' } as const;

beforeEach(() => {
  jest.resetAllMocks();
  cameraPermission.mockResolvedValue(granted as never);
});

describe('pickFromLibrary', () => {
  it('asks for one picture and returns it as an attachment', async () => {
    library.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///p.jpg',
          width: 1,
          height: 1,
          fileName: 'p.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1234,
        },
      ],
    });
    await expect(pickFromLibrary()).resolves.toEqual({
      status: 'picked',
      attachment: {
        uri: 'file:///p.jpg',
        name: 'p.jpg',
        mime: 'image/jpeg',
        sizeBytes: 1234,
        kind: 'image',
      },
    });
    expect(library).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false }),
    );
  });

  it('asks for videos only when the Video tile is chosen', async () => {
    library.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///v.mp4',
          width: 1,
          height: 1,
          fileName: 'v.mp4',
          mimeType: 'video/mp4',
          fileSize: 5000,
        },
      ],
    });
    await expect(pickFromLibrary('video')).resolves.toMatchObject({
      status: 'picked',
      attachment: { name: 'v.mp4', kind: 'video' },
    });
    expect(library).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['videos'], allowsMultipleSelection: false }),
    );
  });

  it('answers canceled when the person goes back', async () => {
    library.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickFromLibrary()).resolves.toEqual({ status: 'canceled' });
  });

  it('answers failed when the picker throws', async () => {
    library.mockRejectedValue(new Error('boom'));
    await expect(pickFromLibrary()).resolves.toEqual({ status: 'failed' });
  });
});

describe('pickFromCamera', () => {
  it('asks for the camera at the moment of use, then takes the photo', async () => {
    camera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c.jpg', width: 1, height: 1 }],
    });
    const result = await pickFromCamera();
    expect(cameraPermission).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'picked',
      attachment: { name: 'photo.jpg', mime: 'image/jpeg', kind: 'image' },
    });
  });

  it('does not open the camera when the permission is refused, and says whether it can be asked again', async () => {
    cameraPermission.mockResolvedValue({
      ...granted,
      status: 'denied',
      granted: false,
      canAskAgain: false,
    } as never);
    await expect(pickFromCamera()).resolves.toEqual({ status: 'cameraDenied', canAskAgain: false });
    expect(camera).not.toHaveBeenCalled();
  });
});

describe('pickDocument', () => {
  it('copies the file to the cache and returns it with its name, type and size', async () => {
    documents.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///cache/r.pdf',
          name: 'r.pdf',
          mimeType: 'application/pdf',
          size: 99,
          lastModified: 0,
        },
      ],
    });
    await expect(pickDocument()).resolves.toEqual({
      status: 'picked',
      attachment: {
        uri: 'file:///cache/r.pdf',
        name: 'r.pdf',
        mime: 'application/pdf',
        sizeBytes: 99,
        kind: 'document',
      },
    });
    expect(documents).toHaveBeenCalledWith(expect.objectContaining({ copyToCacheDirectory: true }));
  });

  it('answers canceled and failed like the other pickers', async () => {
    documents.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(pickDocument()).resolves.toEqual({ status: 'canceled' });
    documents.mockRejectedValueOnce(new Error('boom'));
    await expect(pickDocument()).resolves.toEqual({ status: 'failed' });
  });
});

describe('discardAttachment', () => {
  const file = (uri: string) => ({
    uri,
    name: 'r.pdf',
    mime: 'application/pdf',
    sizeBytes: 1,
    kind: 'document' as const,
  });
  const deleteFile = jest.fn();
  beforeEach(() => {
    deleteFile.mockReset();
    jest.mocked(File).mockImplementation((() => ({ delete: deleteFile })) as never);
  });

  it('deletes the copy the picker left in the cache', () => {
    discardAttachment(file('file:///cache/r.pdf'));
    expect(File).toHaveBeenCalledWith('file:///cache/r.pdf');
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it('leaves a file outside the cache alone: it is the person’s own', () => {
    discardAttachment(file('file:///storage/Downloads/r.pdf'));
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('does not fail when the file is already gone', () => {
    deleteFile.mockImplementation(() => {
      throw new Error('missing');
    });
    expect(() => discardAttachment(file('file:///cache/r.pdf'))).not.toThrow();
  });
});

describe('pickAudio', () => {
  it('opens the file browser for sounds only and returns the file as an audio attachment', async () => {
    documents.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/a.mp3', name: 'a.mp3', mimeType: 'audio/mpeg', size: 900 }],
    } as never);
    await expect(pickAudio()).resolves.toEqual({
      status: 'picked',
      attachment: {
        uri: 'file:///cache/a.mp3',
        name: 'a.mp3',
        mime: 'audio/mpeg',
        sizeBytes: 900,
        kind: 'audio',
      },
    });
    expect(documents).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audio/*', copyToCacheDirectory: true }),
    );
  });

  it('answers canceled when the person goes back, and failed when the browser throws', async () => {
    documents.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(pickAudio()).resolves.toEqual({ status: 'canceled' });
    documents.mockRejectedValueOnce(new Error('boom'));
    await expect(pickAudio()).resolves.toEqual({ status: 'failed' });
  });
});
